# Jira n8n Bridge: Privacy Policy

Last updated: [DATE OF PUBLICATION]

## Who we are
Jira n8n Bridge is a Forge app for Jira Cloud. Contact: ricardonldev@gmail.com.

## What the app processes
When a Jira admin configures the app, it sends these fields of issues that are created, updated or commented to the n8n webhook URL chosen by the admin:
- issue ID and key;
- summary;
- project key;
- issue type;
- status;
- the fields that changed, with their old and new values;
- the text of new comments.

The app does not send names, email addresses or account IDs of users.

## Where data is stored
- The app runs on Atlassian Forge. Its settings, the n8n webhook URL and the shared secret (encrypted), are stored in Forge storage within your Atlassian site's data residency.
- We do not run our own servers and we do not receive, store or have access to your Jira data.
- Data sent to n8n is processed by the n8n instance that your admin configured, under that service's terms and privacy policy.

## Logs
Forge keeps short-lived technical logs (for example, "issue sent, status 200") for troubleshooting, managed by Atlassian.

## Your control
- Admins can change the n8n URL or create a new secret at any time from the settings page.
- Uninstalling the app stops all data transfers, and its stored settings are deleted by Atlassian under its Forge data retention rules.

## Changes
We will update this page if the app starts processing different data.
