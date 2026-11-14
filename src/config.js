// Shared settings: stored in Forge storage, with environment variables as a fallback for testing.
const { kvs } = require('@forge/kvs');
const crypto = require('node:crypto');

const URL_KEY = 'n8nWebhookUrl';
const SECRET_KEY = 'bridgeSecret';

// Hosts the app is allowed to call (must match permissions.external.fetch.backend in manifest.yml).
const ALLOWED_HOST = /(^|\.)app\.n8n\.cloud$/;

const getWebhookUrl = async () => (await kvs.get(URL_KEY)) || process.env.N8N_WEBHOOK_URL || '';
const getSecret = async () => (await kvs.getSecret(SECRET_KEY)) || process.env.BRIDGE_SECRET || '';

// Returns an error message, or '' when the URL is acceptable.
const checkWebhookUrl = (value) => {
  let u;
  try { u = new URL(String(value).trim()); } catch { return 'Enter a full URL, for example https://yourname.app.n8n.cloud/webhook/jira'; }
  if (u.protocol !== 'https:') return 'The URL must start with https://';
  if (!ALLOWED_HOST.test(u.hostname)) return 'Only n8n Cloud URLs (*.app.n8n.cloud) are supported in this version';
  return '';
};

const saveWebhookUrl = (value) => kvs.set(URL_KEY, new URL(String(value).trim()).toString());

// Creates a new random secret, stores it encrypted and returns it so the admin can copy it once.
const rotateSecret = async () => {
  const secret = crypto.randomBytes(24).toString('hex');
  await kvs.setSecret(SECRET_KEY, secret);
  return secret;
};

module.exports = { getWebhookUrl, getSecret, checkWebhookUrl, saveWebhookUrl, rotateSecret };
