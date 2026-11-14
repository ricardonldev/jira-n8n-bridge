// Jira <-> n8n bridge.
// - onIssueEvent: Jira events (created, updated, commented) -> POST to the n8n webhook set on the admin page.
// - inbound: n8n -> web trigger -> comment, transition or label a Jira issue, protected by a shared secret.
// - adminResolver: backend of the admin page (save the n8n URL, create the secret).
const api = require('@forge/api');
const { route, webTrigger } = api;
const Resolver = require('@forge/resolver').default;
const crypto = require('node:crypto');
const config = require('./config');

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': ['application/json'] },
  body: JSON.stringify(body)
});

// Constant-time comparison so the secret cannot be guessed by timing.
const sameSecret = (given, expected) => {
  if (!given || !expected) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

// Short names for the Jira event types sent to n8n.
const EVENT_NAMES = {
  'avi:jira:created:issue': 'issue_created',
  'avi:jira:updated:issue': 'issue_updated',
  'avi:jira:commented:issue': 'issue_commented'
};

// Jira comments arrive in Atlassian Document Format (ADF): keep only the plain text.
const adfText = (node) => {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.type === 'text') return node.text || '';
  // Paragraphs of the document are joined with line breaks.
  return (node.content || []).map(adfText).join(node.type === 'doc' ? '\n' : '');
};

exports.onIssueEvent = async (event) => {
  const url = await config.getWebhookUrl();
  if (!url) { console.warn('No n8n webhook URL configured'); return; }
  const issue = event.issue || {};
  // Only the fields n8n needs; no user names or emails are sent.
  const payload = {
    event: EVENT_NAMES[event.eventType] || event.eventType,
    issueId: issue.id,
    issueKey: issue.key,
    summary: issue.fields?.summary,
    projectKey: issue.fields?.project?.key,
    issueType: issue.fields?.issuetype?.name,
    status: issue.fields?.status?.name
  };
  // Updated issues: which fields changed, with old and new values.
  if (event.changelog?.items) {
    payload.changes = event.changelog.items.map((i) => ({ field: i.field, from: i.fromString ?? null, to: i.toString ?? null }));
  }
  // Commented issues: the comment id and its plain text.
  if (event.comment) payload.comment = { id: event.comment.id, text: adfText(event.comment.body).slice(0, 5000) };

  const res = await api.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Bridge-Secret': await config.getSecret() },
    body: JSON.stringify(payload)
  });
  // Echo services return what they received: log it to check the payload during tests.
  let echoed = '';
  try { const b = await res.json(); echoed = JSON.stringify(b.json || b.data || {}); } catch { /* n8n may return non-JSON */ }
  console.log('Sent', payload.event, issue.key, 'to n8n, status', res.status, echoed.slice(0, 400));
};

// ---- n8n -> Jira actions ----
const jira = (path, options = {}) => api.asApp().requestJira(path, {
  ...options,
  headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(options.headers || {}) }
});

// Each action returns { ok, status, error? }.
const ACTIONS = {
  // { action: "comment", comment: "text" }
  comment: async (key, body) => {
    if (!body.comment) return { ok: false, status: 400, error: 'comment is required' };
    const res = await jira(route`/rest/api/3/issue/${key}/comment`, {
      method: 'POST',
      body: JSON.stringify({
        body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: String(body.comment).slice(0, 5000) }] }] }
      })
    });
    return { ok: res.ok, status: res.status };
  },
  // { action: "transition", transition: "Done" }  (name of the transition or of the target status, case-insensitive)
  transition: async (key, body) => {
    const wanted = String(body.transition || '').trim().toLowerCase();
    if (!wanted) return { ok: false, status: 400, error: 'transition is required' };
    const list = await jira(route`/rest/api/3/issue/${key}/transitions`);
    if (!list.ok) return { ok: false, status: list.status };
    const { transitions = [] } = await list.json();
    const t = transitions.find((x) => x.name.toLowerCase() === wanted || x.to?.name?.toLowerCase() === wanted || x.id === wanted);
    if (!t) return { ok: false, status: 400, error: 'No transition named "' + body.transition + '". Available: ' + transitions.map((x) => x.name).join(', ') };
    const res = await jira(route`/rest/api/3/issue/${key}/transitions`, { method: 'POST', body: JSON.stringify({ transition: { id: t.id } }) });
    return { ok: res.ok, status: res.status };
  },
  // { action: "labels", labels: ["from-n8n"] }  (adds labels; Jira labels cannot contain spaces)
  labels: async (key, body) => {
    const labels = [].concat(body.labels || []).map((l) => String(l).trim()).filter(Boolean);
    if (!labels.length || labels.some((l) => /\s/.test(l))) return { ok: false, status: 400, error: 'labels must be a list of words without spaces' };
    const res = await jira(route`/rest/api/3/issue/${key}`, { method: 'PUT', body: JSON.stringify({ update: { labels: labels.map((l) => ({ add: l })) } }) });
    return { ok: res.ok, status: res.status };
  }
};

exports.inbound = async (request) => {
  const headers = request.headers || {};
  const secret = (headers['x-bridge-secret'] || [])[0];
  if (!sameSecret(secret, await config.getSecret())) return json(401, { error: 'unauthorized' });

  let body;
  try { body = JSON.parse(request.body || '{}'); } catch { return json(400, { error: 'invalid JSON' }); }
  const issueKey = body.issueKey;
  const action = body.action || 'comment'; // "comment" by default, as in the first version
  if (!/^[A-Z][A-Z0-9_]+-\d+$/.test(issueKey || '')) return json(400, { error: 'issueKey is required, for example PROJ-123' });
  if (!ACTIONS[action]) return json(400, { error: 'action must be one of: ' + Object.keys(ACTIONS).join(', ') });

  // asApp: there is no user in a web trigger; the shared secret is the authorization check.
  const r = await ACTIONS[action](issueKey, body);
  if (r.error) return json(r.status, { error: r.error });
  if (!r.ok) return json(502, { error: 'Jira returned ' + r.status });
  return json(200, { ok: true, issueKey, action });
};

// ---- Admin page backend ----
const resolver = new Resolver();

// The admin page is only shown to Jira admins, but the backend checks again with the user's own permissions.
const assertAdmin = async () => {
  const res = await api.asUser().requestJira(route`/rest/api/3/mypermissions?permissions=ADMINISTER`);
  const data = await res.json();
  if (!data?.permissions?.ADMINISTER?.havePermission) throw new Error('Only Jira administrators can change these settings');
};

resolver.define('getConfig', async () => {
  await assertAdmin();
  return {
    webhookUrl: await config.getWebhookUrl(),
    hasSecret: Boolean(await config.getSecret()),
    inboundUrl: await webTrigger.getUrl('n8n-inbound')
  };
});

resolver.define('saveWebhookUrl', async ({ payload }) => {
  await assertAdmin();
  const error = config.checkWebhookUrl(payload?.url);
  if (error) return { ok: false, error };
  await config.saveWebhookUrl(payload.url);
  return { ok: true };
});

resolver.define('rotateSecret', async () => {
  await assertAdmin();
  return { secret: await config.rotateSecret() };
});

exports.adminResolver = resolver.getDefinitions();
