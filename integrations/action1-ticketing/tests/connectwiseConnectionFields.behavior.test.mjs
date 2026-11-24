import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';

const server = await createServer({
  configFile: false,
  plugins: [react()],
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error'
});

try {
  const { default: ConnectionFields } = await server.ssrLoadModule('/integrations/action1-ticketing/ui/providers/ConnectWiseConnectionFields.jsx');
  const fields = (region) => renderToStaticMarkup(createElement(ConnectionFields, {
    settings: {
      TicketingProvider_connectwise_psa_ApiRegion: region,
      TicketingProvider_connectwise_psa_CompanyId: 'tenant',
      TicketingProvider_connectwise_psa_PublicApiKey: 'public',
      TicketingProvider_connectwise_psa_PrivateApiKey: '***'
    },
    setSettings() {},
    storedSecrets: { TicketingProvider_connectwise_psa_PrivateApiKey: true }
  }));

  const standard = fields('NA');
  for (const label of ['API Region / Server', 'PSA Company ID', 'Public API Key', 'Private API Key']) {
    assert.match(standard, new RegExp(label));
  }
  assert.match(standard, /type="password"/);
  assert.match(standard, /North America/);
  assert.doesNotMatch(standard, /Client ID|synthetic-action1-client-id/);
  assert.doesNotMatch(standard, /Custom server URL/);

  const custom = fields('CUSTOM');
  assert.match(custom, /Custom HTTPS Server/);
  assert.match(custom, /type="url"/);
  console.log('ConnectWise ConnectionFields behavior tests passed.');
} finally {
  await server.close();
}
