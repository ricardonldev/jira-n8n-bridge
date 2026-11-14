# Jira n8n Bridge

A Forge app that connects Jira Cloud and n8n in both directions:

- **Jira to n8n:** issue created, updated (with changed fields) and commented (with the comment text) are sent to an n8n webhook.
- **n8n to Jira:** n8n can comment, transition and label issues through the app's web trigger.

It does not use Jira automation rules, so it does not count against your Jira automation usage, and n8n does not need a personal API token.

## Setup
1. Install the app on your Jira Cloud site.
2. Open **Jira settings > Apps > Connect Jira to n8n** and click **Create secret**.
3. In n8n Cloud, import [`n8n/jira-bridge-example.json`](n8n/jira-bridge-example.json).
4. Create a **Header Auth** credential named "Jira bridge secret", with name `X-Bridge-Secret` and the secret as its value. Select it in the 4 nodes that use it.
5. Paste the "n8n to Jira" URL from the settings page into the **Settings** node, then activate the workflow.
6. Paste the production URL of the **Jira events** node into the settings page and save.

## Events sent to n8n
```json
{ "event": "issue_updated", "issueId": "10001", "issueKey": "PROJ-2", "summary": "...", "projectKey": "PROJ",
  "issueType": "Task", "status": "Done", "changes": [{ "field": "summary", "from": "Old", "to": "New" }] }
```
`event` is one of `issue_created`, `issue_updated` or `issue_commented`. `issue_commented` adds `comment: { id, text }`. No names, emails or account IDs are sent. Changes made by the app itself are not sent back, so there are no loops.

## Actions n8n can call
POST to the inbound URL with the header `X-Bridge-Secret`:

| Action | Body |
|---|---|
| Comment (default) | `{ "issueKey": "PROJ-1", "comment": "Text" }` |
| Transition | `{ "issueKey": "PROJ-1", "action": "transition", "transition": "Done" }`: transition or status name, case-insensitive |
| Labels | `{ "issueKey": "PROJ-1", "action": "labels", "labels": ["from-n8n"] }` |

Errors return a clear message, for example the list of available transitions.

## Security
- The shared secret is stored encrypted in Forge storage and shown only once. It is compared in constant time.
- The settings page checks the Jira admin permission again on the backend.
- Outbound calls are allowed only to `*.app.n8n.cloud`.

## Development
```bash
npm install
npm test                      # 14 unit tests (node:test, Forge modules mocked)
forge deploy -e development
forge install -e development --site <your-site>.atlassian.net --product jira
node n8n/generar.mjs          # regenerates the example workflow
```

## Privacy
See [docs/privacy.md](docs/privacy.md).

## License
MIT
