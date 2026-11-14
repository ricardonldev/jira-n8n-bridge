// Generates the example n8n workflow that goes with the Forge app (for users and Codegeist judges).
// Usage: node generar.mjs                      -> jira-bridge-example.json (public, uses a Header Auth credential)
//        node generar.mjs --prueba <out> <inboundUrl> <secretFile>
//                                              -> test copy: Manual trigger + 3 fake events, secret as a plain header (never commit it)
import fs from 'node:fs';

const [, , flag, out, inboundUrl, secretFile] = process.argv;
const prueba = flag === '--prueba';
const secret = prueba ? fs.readFileSync(secretFile, 'utf8').trim() : '';

const body = '$(\'Jira events\').item.json.body';
const rule = (key, conditions) => ({
  conditions: { options: { caseSensitive: false, leftValue: '', typeValidation: 'loose', version: 2 }, conditions, combinator: 'and' },
  renameOutput: true, outputKey: key
});
const eq = (left, right) => ({ leftValue: `={{ ${left} }}`, rightValue: right, operator: { type: 'string', operation: 'equals' } });
const starts = (left, right) => ({ leftValue: `={{ ${left} }}`, rightValue: right, operator: { type: 'string', operation: 'startsWith' } });

// Calls back into Jira through the app's web trigger.
const back = (name, json, y) => ({
  parameters: {
    method: 'POST',
    url: '={{ $(\'Settings\').first().json.jiraInboundUrl }}',
    ...(prueba
      ? { sendHeaders: true, headerParameters: { parameters: [{ name: 'X-Bridge-Secret', value: secret }] } }
      : { authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth' }),
    sendBody: true, specifyBody: 'json', jsonBody: json,
    options: { timeout: 15000 }
  },
  name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [900, y],
  retryOnFail: true, maxTries: 3, waitBetweenTries: 3000,
  ...(prueba ? {} : { credentials: { httpHeaderAuth: { id: '', name: 'Jira bridge secret' } } })
});

const trigger = prueba
  ? [
      { parameters: {}, name: 'Run test', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [-200, 0] },
      { parameters: { jsCode: `const k = 'BRG-3';
return [
  { json: { body: { event: 'issue_created', issueKey: k, summary: 'Test', projectKey: 'BRG' } } },
  { json: { body: { event: 'issue_updated', issueKey: k, changes: [{ field: 'summary', from: 'a', to: 'b' }] } } },
  { json: { body: { event: 'issue_commented', issueKey: k, comment: { id: '1', text: '/done please' } } } }
];` }, name: 'Jira events', type: 'n8n-nodes-base.code', typeVersion: 2, position: [0, 0] }
    ]
  : [{
      parameters: { httpMethod: 'POST', path: 'jira-bridge', authentication: 'headerAuth', options: {} },
      name: 'Jira events', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0], webhookId: 'jira-bridge',
      credentials: { httpHeaderAuth: { id: '', name: 'Jira bridge secret' } }
    }];

const nodes = [
  ...trigger,
  { parameters: { assignments: { assignments: [{ id: 'url', name: 'jiraInboundUrl', type: 'string', value: prueba ? inboundUrl : 'PASTE_THE_URL_FROM_JIRA_SETTINGS' }] }, options: {} },
    name: 'Settings', type: 'n8n-nodes-base.set', typeVersion: 3.4, position: [220, 0] },
  { parameters: { rules: { values: [
      rule('New issue', [eq(`${body}.event`, 'issue_created')]),
      rule('Comment starting with /done', [eq(`${body}.event`, 'issue_commented'), starts(`${body}.comment.text`, '/done')]),
      rule('Issue updated', [eq(`${body}.event`, 'issue_updated')])
    ] }, options: {} },
    name: 'What happened in Jira', type: 'n8n-nodes-base.switch', typeVersion: 3.2, position: [440, 0] },
  back('Reply with a comment', `={{ JSON.stringify({ issueKey: ${body}.issueKey, action: 'comment', comment: 'n8n received this new issue from project ' + ${body}.projectKey + '.' }) }}`, -200),
  back('Move the issue to Done', `={{ JSON.stringify({ issueKey: ${body}.issueKey, action: 'transition', transition: 'Done' }) }}`, 0),
  back('Add a label', `={{ JSON.stringify({ issueKey: ${body}.issueKey, action: 'labels', labels: ['seen-by-n8n'] }) }}`, 200)
];

if (!prueba) nodes.push({
  parameters: { content: `## Jira <-> n8n bridge (example)
Works with the **Jira n8n Bridge** Forge app.

### What it does
- A new Jira issue gets a comment back from n8n.
- A comment starting with **/done** moves the issue to Done.
- Any other update adds the label **seen-by-n8n**.
Replace these three actions with your own automation: Slack, a database, an AI step, and so on.

### Setup (5 minutes)
1. In Jira, open **Settings > Apps > Connect Jira to n8n**, click **Create secret** and copy it.
2. In n8n, create a **Header Auth** credential named "Jira bridge secret": name \`X-Bridge-Secret\`, value = the secret. Select it in **Jira events** and in the three HTTP nodes.
3. Activate this workflow and copy the production URL of **Jira events** into the Jira settings page (n8n webhook URL).
4. Copy the "n8n to Jira" URL from the same page into **Settings**.

Events sent by the app: issue_created, issue_updated (with \`changes\`), issue_commented (with \`comment.text\`). Actions it accepts: comment, transition, labels.` , height: 600, width: 480 },
  name: 'Sticky Note', type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: [-620, -260] });

const connections = {
  ...(prueba ? { 'Run test': { main: [[{ node: 'Jira events', type: 'main', index: 0 }]] } } : {}),
  'Jira events': { main: [[{ node: 'Settings', type: 'main', index: 0 }]] },
  Settings: { main: [[{ node: 'What happened in Jira', type: 'main', index: 0 }]] },
  'What happened in Jira': { main: [
    [{ node: 'Reply with a comment', type: 'main', index: 0 }],
    [{ node: 'Move the issue to Done', type: 'main', index: 0 }],
    [{ node: 'Add a label', type: 'main', index: 0 }]
  ] }
};

const wf = {
  ...(prueba ? { id: 'bridgetest1' } : {}),
  name: 'Jira <-> n8n bridge (example)',
  nodes, connections,
  settings: { executionOrder: 'v1', saveDataErrorExecution: 'all', executionTimeout: 120 },
  active: false
};
const file = prueba ? out : new URL('./jira-bridge-example.json', import.meta.url);
fs.writeFileSync(file, JSON.stringify(wf, null, 2));
console.log('Written', String(file));
