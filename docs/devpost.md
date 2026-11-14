# Jira n8n Bridge (Devpost submission draft)

**Category:** Apps for Teamwork foundations (alternative: World-class software development)
**Bonus prize:** none (the app calls n8n, so it is not "Runs on Atlassian")

## Tagline
Two-way bridge between Jira and n8n: send issue events to any n8n workflow and let n8n comment on, transition and label issues, without using your Jira automation quota.

## Inspiration
Many teams already run their processes in n8n: approvals, AI triage, syncing with CRMs and databases. Connecting it to Jira usually means a Jira automation rule that calls a webhook, which uses up the monthly automation quota, plus a personal API token stored in n8n so it can write back. Tokens tied to one person break when that person leaves and give n8n more access than it needs.

## What it does
- **Jira to n8n:** issue created, updated (with the list of changed fields, old and new values) and commented (with the plain text of the comment) are sent to an n8n webhook.
- **n8n to Jira:** n8n calls the app's web trigger to add a comment, move an issue through a transition (by transition or status name) or add labels.
- **One settings page** for Jira admins: paste the n8n webhook URL, copy the inbound URL, create a shared secret.
- **No loops:** changes made by the app are not sent back to n8n.
- **Privacy by default:** no names or email addresses are sent; only issue key, summary, project, type, status, changes and comment text.

## How we built it
- Forge: product event trigger (created, updated, commented, with ignoreSelf), web trigger for inbound calls, Jira admin page in UI Kit, Forge Key-Value Store with encrypted secrets.
- Security: shared secret in a header, compared in constant time; it is stored encrypted and shown only once. The settings backend checks the user's ADMINISTER permission again before reading or changing anything. Outbound calls go only to *.app.n8n.cloud (Forge egress allowlist).
- An example n8n workflow is included, with a Header Auth credential and three branches: reply with a comment, "/done" closes the issue, and updates add a label.
- 14 unit tests (node:test with the Forge modules mocked) and end-to-end tests on a real Jira Cloud site.

## Challenges
- A controlled UI Kit text field dropped keystrokes; switching it to an uncontrolled field fixed it.
- Avoiding infinite loops when n8n writes back to the same issue: solved with the trigger's ignoreSelf filter, and verified in the logs.
- Keeping Jira automation usage at zero: Forge triggers are not automation rules, so they do not count against the automation limits that apply to Jira Cloud plans.

## Accomplishments
- A full round trip in five minutes of setup, with no API tokens of a real person.
- Clear error messages for n8n builders. For example, an unknown transition returns the list of available ones.

## What we learned
Forge's event filters, web triggers and encrypted storage are enough for a secure integration without any external server.

## What's next
- More actions: set fields, assign, create linked issues.
- Choose which events and projects are sent from the settings page.
- Support for self-hosted n8n, with an admin-approved domain.
- Marketplace listing.

## Testing instructions for judges
1. Install the app with the installation link on a Jira Cloud site where you are an admin.
2. Open **Jira settings > Apps > Connect Jira to n8n** and click **Create secret**.
3. In n8n Cloud (a free trial works), import `n8n/jira-bridge-example.json`.
   - Create a Header Auth credential with the name `X-Bridge-Secret` and the secret as its value, and select it in the 4 nodes that use it.
   - Paste the "n8n to Jira" URL into the **Settings** node.
   - Activate the workflow.
4. Paste the production URL of the **Jira events** node into the settings page and click **Save URL**.
5. Create an issue: n8n replies with a comment. Comment "/done": the issue moves to Done. Edit the summary: the label seen-by-n8n is added.

## Built with
forge, jira, n8n, javascript, ui-kit, nodejs
