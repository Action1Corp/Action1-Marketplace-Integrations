const test = require('node:test');
const assert = require('node:assert/strict');
const { actions } = require('./index');
test('connection exposes capability without API credentials', async () => {
 const result = await actions.connection({ action1: { getCredentials: async () => ({ etpEnabled:true, organizationId:'org', baseUrl:'url', apiKey:'secret-id', apiSecret:'secret' }) } });
 assert.deepEqual(result, {ok:true,etpEnabled:true,organizationId:'org',baseUrl:'url'});
});
test('signing harness preserves exact configurations and delegates without HTTP submission', async () => {
 const objects = [{id:'one',configuration:{id:'original', type:'AutomationScheduleConfiguration', organization_id:'org', actions:[{id:'action'}]}}];
 const context = { action1: { provisioner: {
  prepareSigning: async input => { assert.deepEqual(input,{idempotencyKey:'intent',objects}); return {ok:true,signingId:'job',digest:'digest'}; },
  getSigning: async id => { assert.equal(id,'job'); return {state:'signed',expiresAt:123,objects,results:[{id:'one',signature:{alg:'alg',iat:1,kid:'kid',value:'value'}}]}; }
 } }, http: new Proxy({}, {get(){throw new Error('No HTTP calls allowed');}}) };
 const prepared=await actions['prepare-signing'](context,{payload:{intentId:'intent',objects}});
 const result=await actions['read-signing'](context,{payload:{signingId:prepared.signingId}});
 assert.equal(result.state,'signed'); assert.deepEqual(result.objects,objects); assert.equal(result.results[0].signature.value,'value');
});
