// Unit tests for the bridge, with the Forge modules replaced by fakes.
// Run: npm test   (uses node:test, no extra dependencies)
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// ---- Fakes for @forge/api, @forge/kvs and @forge/resolver ----
const state = { store: {}, secrets: {}, fetches: [], jiraCalls: [], jiraHandler: null, isAdmin: true };

const fakeResponse = (status, body) => ({
  status, ok: status >= 200 && status < 300,
  json: async () => body, text: async () => JSON.stringify(body)
});

const fakeApi = {
  route: (strings, ...values) => strings.reduce((acc, s, i) => acc + s + (i < values.length ? encodeURIComponent(values[i]) : ''), ''),
  webTrigger: { getUrl: async () => 'https://example.webtrigger.test/inbound' },
  fetch: async (url, options) => { state.fetches.push({ url, options }); return fakeResponse(200, {}); },
  asApp: () => ({ requestJira: async (p, o = {}) => { state.jiraCalls.push({ path: p, ...o }); return state.jiraHandler(p, o); } }),
  asUser: () => ({ requestJira: async () => fakeResponse(200, { permissions: { ADMINISTER: { havePermission: state.isAdmin } } }) })
};
const fakeKvs = {
  kvs: {
    get: async (k) => state.store[k], set: async (k, v) => { state.store[k] = v; },
    getSecret: async (k) => state.secrets[k], setSecret: async (k, v) => { state.secrets[k] = v; }
  }
};
class FakeResolver {
  constructor() { this.defs = {}; }
  define(name, fn) { this.defs[name] = fn; }
  getDefinitions() { return this.defs; }
}

const inject = (name, exports) => {
  const id = require.resolve(name, { paths: [path.join(__dirname, '..')] });
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
inject('@forge/api', fakeApi);
inject('@forge/kvs', fakeKvs);
inject('@forge/resolver', { default: FakeResolver });

const bridge = require('../src/index.js');
const config = require('../src/config.js');

const SECRET = 'test-secret-value';
const reset = () => {
  state.store = { n8nWebhookUrl: 'https://demo.app.n8n.cloud/webhook/jira' };
  state.secrets = { bridgeSecret: SECRET };
  state.fetches = []; state.jiraCalls = []; state.isAdmin = true;
  state.jiraHandler = () => fakeResponse(204, {});
};
const call = (body, secret = SECRET) => bridge.inbound({
  headers: secret ? { 'x-bridge-secret': [secret] } : {},
  body: typeof body === 'string' ? body : JSON.stringify(body)
});
const parse = (res) => ({ status: res.statusCode, body: JSON.parse(res.body) });

// ---- Jira -> n8n ----
test('issue created: sends only the needed fields, with the secret header', async () => {
  reset();
  await bridge.onIssueEvent({
    eventType: 'avi:jira:created:issue',
    issue: { id: '1', key: 'BRG-1', fields: { summary: 'Hello', project: { key: 'BRG' }, issuetype: { name: 'Task' }, status: { name: 'To Do' }, reporter: { displayName: 'Someone', emailAddress: 'a@b.c' } } }
  });
  assert.equal(state.fetches.length, 1);
  const { url, options } = state.fetches[0];
  assert.equal(url, 'https://demo.app.n8n.cloud/webhook/jira');
  assert.equal(options.headers['X-Bridge-Secret'], SECRET);
  const sent = JSON.parse(options.body);
  assert.deepEqual(sent, { event: 'issue_created', issueId: '1', issueKey: 'BRG-1', summary: 'Hello', projectKey: 'BRG', issueType: 'Task', status: 'To Do' });
  assert.ok(!options.body.includes('a@b.c'), 'no emails are sent');
});

test('issue updated: includes the changed fields', async () => {
  reset();
  await bridge.onIssueEvent({
    eventType: 'avi:jira:updated:issue',
    issue: { id: '1', key: 'BRG-1', fields: {} },
    changelog: { items: [{ field: 'summary', fromString: 'Old', toString: 'New' }] }
  });
  assert.deepEqual(JSON.parse(state.fetches[0].options.body).changes, [{ field: 'summary', from: 'Old', to: 'New' }]);
});

test('issue commented: sends the plain text of the comment', async () => {
  reset();
  await bridge.onIssueEvent({
    eventType: 'avi:jira:commented:issue',
    issue: { id: '1', key: 'BRG-1', fields: {} },
    comment: { id: '9', body: { type: 'doc', version: 1, content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Line ' }, { type: 'text', text: 'one' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Line two' }] }
    ] } }
  });
  assert.deepEqual(JSON.parse(state.fetches[0].options.body).comment, { id: '9', text: 'Line one\nLine two' });
});

test('no webhook URL configured: nothing is sent', async () => {
  reset();
  state.store = {};
  const saved = process.env.N8N_WEBHOOK_URL; delete process.env.N8N_WEBHOOK_URL;
  await bridge.onIssueEvent({ eventType: 'avi:jira:created:issue', issue: { key: 'BRG-1', fields: {} } });
  if (saved !== undefined) process.env.N8N_WEBHOOK_URL = saved;
  assert.equal(state.fetches.length, 0);
});

// ---- n8n -> Jira ----
test('inbound: missing or wrong secret is rejected before touching Jira', async () => {
  reset();
  assert.equal(parse(await call({ issueKey: 'BRG-1', comment: 'x' }, null)).status, 401);
  assert.equal(parse(await call({ issueKey: 'BRG-1', comment: 'x' }, 'wrong')).status, 401);
  assert.equal(state.jiraCalls.length, 0);
});

test('inbound: bad JSON, bad issue key and unknown action', async () => {
  reset();
  assert.equal(parse(await call('{x')).status, 400);
  assert.equal(parse(await call({ issueKey: 'not a key', comment: 'x' })).status, 400);
  const r = parse(await call({ issueKey: 'BRG-1', action: 'delete' }));
  assert.equal(r.status, 400);
  assert.match(r.body.error, /comment, transition, labels/);
  assert.equal(state.jiraCalls.length, 0);
});

test('inbound: comment is the default action', async () => {
  reset();
  const r = parse(await call({ issueKey: 'BRG-1', comment: 'From n8n' }));
  assert.deepEqual(r, { status: 200, body: { ok: true, issueKey: 'BRG-1', action: 'comment' } });
  assert.equal(state.jiraCalls[0].path, '/rest/api/3/issue/BRG-1/comment');
  assert.equal(JSON.parse(state.jiraCalls[0].body).body.content[0].content[0].text, 'From n8n');
});

test('inbound: transition by status name, case-insensitive', async () => {
  reset();
  state.jiraHandler = (p, o) => (o.method === 'POST'
    ? fakeResponse(204, {})
    : fakeResponse(200, { transitions: [{ id: '31', name: 'Finish', to: { name: 'Done' } }] }));
  const r = parse(await call({ issueKey: 'BRG-1', action: 'transition', transition: 'DONE' }));
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(state.jiraCalls[1].body).transition.id, '31');
});

test('inbound: unknown transition lists the available ones', async () => {
  reset();
  state.jiraHandler = () => fakeResponse(200, { transitions: [{ id: '31', name: 'Finish', to: { name: 'Done' } }] });
  const r = parse(await call({ issueKey: 'BRG-1', action: 'transition', transition: 'Nope' }));
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Available: Finish/);
});

test('inbound: labels are added; labels with spaces are rejected', async () => {
  reset();
  assert.equal(parse(await call({ issueKey: 'BRG-1', action: 'labels', labels: ['bad label'] })).status, 400);
  const r = parse(await call({ issueKey: 'BRG-1', action: 'labels', labels: ['a', 'b'] }));
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(state.jiraCalls[0].body), { update: { labels: [{ add: 'a' }, { add: 'b' }] } });
});

test('inbound: a Jira error becomes 502', async () => {
  reset();
  state.jiraHandler = () => fakeResponse(404, {});
  assert.deepEqual(parse(await call({ issueKey: 'BRG-9', comment: 'x' })), { status: 502, body: { error: 'Jira returned 404' } });
});

// ---- Settings ----
test('webhook URL check: only https n8n Cloud URLs', () => {
  assert.match(config.checkWebhookUrl('nope'), /full URL/);
  assert.match(config.checkWebhookUrl('http://demo.app.n8n.cloud/webhook/x'), /https/);
  assert.match(config.checkWebhookUrl('https://evil.example.com/x'), /n8n Cloud/);
  assert.match(config.checkWebhookUrl('https://app.n8n.cloud.evil.com/x'), /n8n Cloud/);
  assert.equal(config.checkWebhookUrl('https://demo.app.n8n.cloud/webhook/jira'), '');
});

test('admin resolver: non-admins cannot read or change settings', async () => {
  reset();
  state.isAdmin = false;
  await assert.rejects(bridge.adminResolver.getConfig({}), /administrators/);
  await assert.rejects(bridge.adminResolver.rotateSecret({}), /administrators/);
});

test('admin resolver: a new secret replaces the old one', async () => {
  reset();
  const { secret } = await bridge.adminResolver.rotateSecret({});
  assert.equal(secret.length, 48);
  assert.equal(parse(await call({ issueKey: 'BRG-1', comment: 'x' }, SECRET)).status, 401);
  assert.equal(parse(await call({ issueKey: 'BRG-1', comment: 'x' }, secret)).status, 200);
});
