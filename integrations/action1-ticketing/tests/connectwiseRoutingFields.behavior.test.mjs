import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';

const server = await createServer({ configFile: false, plugins: [react()], server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { default: RoutingFields, applyBoardSelection, applyTypeSelection, applySubtypeSelection } = await server.ssrLoadModule('/integrations/action1-ticketing/ui/providers/ConnectWiseRoutingFields.jsx');
  const html = renderToStaticMarkup(createElement(RoutingFields, {
    settings: { TicketingProvider_connectwise_psa_ServiceBoardId: '' },
    setSettings() {}, discoveryState: { loading: true, loaded: false, data: { optionsByKind: {} } }
  }));
  for (const label of ['Service Board', 'Initial Ticket Status', 'Ticket Type', 'Ticket Subtype', 'Ticket Item', 'Priority', 'Source', 'Additional Closed/Resolved Statuses']) assert.match(html, new RegExp(label));
  assert.match(html, /Service Board \*/);
  assert.match(html, /Initial Ticket Status \*/);
  assert.match(html, /Ticket Type \*/);
  assert.match(html, /multiple/);
  assert.match(html, /disabled/);
  const configured = renderToStaticMarkup(createElement(RoutingFields, {
    settings: {
      TicketingProvider_connectwise_psa_ServiceBoardId: '10',
      TicketingProvider_connectwise_psa_InitialStatusId: '22',
      TicketingProvider_connectwise_psa_AdditionalClosedStatusIds: '23'
    }, setSettings() {}, discoveryState: { loading: false, loaded: true, data: { optionsByKind: {
      'board-statuses': [
        { id: '20', label: 'New', metadata: { closedStatus: false, inactive: false } },
        { id: '21', label: 'Native Closed', metadata: { closedStatus: true, inactive: false } },
        { id: '22', label: 'Stale Initial', metadata: { closedStatus: false, inactive: true } },
        { id: '23', label: 'Stale Resolved', metadata: { closedStatus: false, inactive: true } }
      ]
    } } }
  }));
  assert.match(configured, /Stale Initial/);
  assert.match(configured, /Stale Resolved/);
  assert.doesNotMatch(configured, /Native Closed/);
  const routing = {
    TicketingProvider_connectwise_psa_ServiceBoardId: '10', TicketingProvider_connectwise_psa_InitialStatusId: '20',
    TicketingProvider_connectwise_psa_TicketTypeId: '30', TicketingProvider_connectwise_psa_TicketSubtypeId: '31',
    TicketingProvider_connectwise_psa_TicketItemId: '32', TicketingProvider_connectwise_psa_AdditionalClosedStatusIds: '23',
    TicketingProvider_connectwise_psa_PriorityId: '40'
  };
  const changedBoard = applyBoardSelection(routing, '11');
  assert.equal(changedBoard.TicketingProvider_connectwise_psa_ServiceBoardId, '11');
  for (const field of ['InitialStatusId', 'TicketTypeId', 'TicketSubtypeId', 'TicketItemId', 'AdditionalClosedStatusIds']) assert.equal(changedBoard[`TicketingProvider_connectwise_psa_${field}`], '', `${field} is cleared when Board changes`);
  assert.equal(changedBoard.TicketingProvider_connectwise_psa_PriorityId, '40', 'global Priority remains when Board changes');
  const associations = [
    { metadata: { typeId: '30', subtypeId: '31', itemId: '32' } },
    { metadata: { typeId: '30', subtypeId: '31', itemId: '33' } }
  ];
  const compatibleType = applyTypeSelection(routing, '30', associations);
  assert.equal(compatibleType.TicketingProvider_connectwise_psa_TicketSubtypeId, '31', 'compatible subtype is retained on Type change');
  assert.equal(compatibleType.TicketingProvider_connectwise_psa_TicketItemId, '32', 'compatible item is retained on Type change');
  const incompatibleType = applyTypeSelection(routing, '99', associations);
  assert.equal(incompatibleType.TicketingProvider_connectwise_psa_TicketSubtypeId, '');
  assert.equal(incompatibleType.TicketingProvider_connectwise_psa_TicketItemId, '');
  const changedSubtype = applySubtypeSelection(routing, '', associations);
  assert.equal(changedSubtype.TicketingProvider_connectwise_psa_TicketItemId, '', 'Subtype change clears an Item that is associated with another subtype');
  console.log('ConnectWise routing fields behavior tests passed.');
} finally { await server.close(); }
