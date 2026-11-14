// Admin page: where a Jira admin connects the app to n8n.
// The text field is uncontrolled (defaultValue): a controlled field drops keystrokes in UI Kit.
import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Heading, Text, Textfield, Button, SectionMessage, Code, Stack, Label } from '@forge/react';
import { invoke } from '@forge/bridge';

const App = () => {
  const [cfg, setCfg] = useState(null);
  const [url, setUrl] = useState('');
  const [message, setMessage] = useState(null);
  const [secret, setSecret] = useState('');

  useEffect(() => {
    invoke('getConfig')
      .then((c) => { setCfg(c); setUrl(c.webhookUrl || ''); })
      .catch((e) => setMessage({ appearance: 'error', text: e.message }));
  }, []);

  const save = async () => {
    const r = await invoke('saveWebhookUrl', { url });
    setMessage(r.ok ? { appearance: 'success', text: 'n8n webhook URL saved.' } : { appearance: 'error', text: r.error });
  };

  const newSecret = async () => {
    const r = await invoke('rotateSecret');
    setSecret(r.secret);
    setCfg({ ...cfg, hasSecret: true });
  };

  if (!cfg && !message) return <Text>Loading...</Text>;

  return (
    <Stack space="space.200">
      {message && <SectionMessage appearance={message.appearance}><Text>{message.text}</Text></SectionMessage>}

      <Heading as="h3">1. Jira to n8n</Heading>
      <Text>New issues are sent to this n8n webhook (a Webhook node with the POST method).</Text>
      <Label labelFor="url">n8n webhook URL</Label>
      <Textfield id="url" key={cfg ? "loaded" : "loading"} defaultValue={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://yourname.app.n8n.cloud/webhook/jira" />
      <Button appearance="primary" onClick={save}>Save URL</Button>

      <Heading as="h3">2. n8n to Jira</Heading>
      <Text>To add a comment from n8n, send a POST from an HTTP Request node to this URL with the JSON body issueKey and comment:</Text>
      {cfg && <Code>{cfg.inboundUrl}</Code>}

      <Heading as="h3">3. Shared secret</Heading>
      <Text>Both directions use the header X-Bridge-Secret. {cfg?.hasSecret ? 'A secret is set.' : 'No secret is set yet.'}</Text>
      <Button onClick={newSecret}>{cfg?.hasSecret ? 'Create a new secret' : 'Create secret'}</Button>
      {secret && (
        <SectionMessage appearance="warning">
          <Text>Copy it now into n8n; it will not be shown again. Creating a new one replaces it.</Text>
          <Code>{secret}</Code>
        </SectionMessage>
      )}
    </Stack>
  );
};

ForgeReconciler.render(<React.StrictMode><App /></React.StrictMode>);
