import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';

const server = await createServer({ configFile: false, plugins: [react()], server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { default: DestinationFields } = await server.ssrLoadModule('/integrations/action1-ticketing/ui/providers/ConnectWiseDestinationMappingFields.jsx');
  const html = renderToStaticMarkup(createElement(DestinationFields, {
    row: { action1OrgName: 'Acme Org', destinationId: '456' },
    selectedOption: { id: '456', name: 'Blocked Company', destinationEligibility: { eligible: false, eligibilityKnown: true, eligibilityReason: 'This company status does not allow tickets.' } },
    options: [{ id: '123', name: 'Allowed Company', metadata: { eligible: true, eligibilityKnown: true } }, { id: '456', name: 'Blocked Company', metadata: { eligible: false, eligibilityKnown: true, eligibilityReason: 'This company status does not allow tickets.' } }]
  }));
  assert.match(html, /This company status does not allow tickets/);
  assert.match(html, /Blocked Company/);
  assert.match(html, /disabled=""/);
  console.log('ConnectWise destination eligibility UI tests passed.');
} finally { await server.close(); }
