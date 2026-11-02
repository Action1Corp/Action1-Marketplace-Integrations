import React, { useEffect, useState } from 'react';
async function action(id, payload = {}) {
  const response = await fetch(`/api/integrations/signing-test/actions/${id}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payload, trackHistory: false })
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.message || data.error || 'Request failed.');
  return data;
}
function samples(organizationId, count) {
  return Array.from({ length: count }, (_, i) => ({ id: `sample-${i + 1}`, configuration: {
    id: crypto.randomUUID(), type: 'AutomationScheduleConfiguration', organization_id: organizationId,
    name: `Signing test ${i + 1}`, settings: `DISABLED EVERY:60 AT:00-00-00 DATE:${new Date().toISOString().slice(0, 10)}`,
    retry_minutes: '60', actions: [{ id: crypto.randomUUID(), template_id: 'run_script', params: {
      platform: 'Windows', run_script_language: 'PowerShell', run_script_text: 'Write-Output "Marketplace signing test"',
      run_script_params: [], condition_script_language: 'PowerShell', condition_script_text: '',
      reboot_options: { auto_reboot: 'no' }, reboot_exit_codes: ''
    } }]
  } }));
}
function Dashboard() {
  const [connection, setConnection] = useState(null), [org, setOrg] = useState(''), [count, setCount] = useState(2);
  const [text, setText] = useState(''), [prepared, setPrepared] = useState(null), [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { action('connection').then(c => { setConnection(c); setOrg(c.organizationId); }).catch(e => setError(e.message)); }, []);
  async function run(fn) { setBusy(true); setError(''); try { await fn(); } catch(e) { setError(e.message); } finally { setBusy(false); } }
  function reset() { setPrepared(null); setResult(null); setError(''); }
  async function prepare() {
    const objects = JSON.parse(text);
    const job = await action('prepare-signing', { intentId: crypto.randomUUID(), objects });
    setPrepared(job); setResult(null);
  }
  async function sign() {
    if (!window.Action1Marketplace?.provisioner?.sign) throw new Error('Reload Marketplace to load the signing capability.');
    await window.Action1Marketplace.provisioner.sign({ integrationId: 'signing-test', signingId: prepared.signingId, digest: prepared.digest });
    setResult(await action('read-signing', { signingId: prepared.signingId }));
  }
  return <div style={{ maxWidth: 1100, margin: '0 auto', padding: 24 }}>
    <h1>ETP Signing Test</h1>
    <p>Review configurations, sign a batch with one Marketplace prompt, and inspect the returned signatures. This test does not create or publish automations.</p>
    {error && <div role="alert" style={{ color: '#a40000', background: '#fff1f1', padding: 16 }}>{error}</div>}
    {connection && !connection.etpEnabled && <p role="alert">Select ETP in Marketplace Settings and save your signing key before testing.</p>}
    <section className="glass-panel" style={{ padding: 24, marginBottom: 24 }}>
      <h2>1. Build Test Configurations</h2>
      <p>{connection?.baseUrl}</p>
      <label>Action1 Organization ID<input className="form-control" value={org} disabled={busy || !!prepared} onChange={e => setOrg(e.target.value)} /></label>
      <label>Configurations (1–100)<input className="form-control" type="number" min="1" max="100" value={count} disabled={busy || !!prepared} onChange={e => setCount(Number(e.target.value))} /></label>
      <button className="btn btn-secondary" disabled={busy || !!prepared || !org.trim() || !Number.isInteger(count) || count < 1 || count > 100} onClick={() => { reset(); setText(JSON.stringify(samples(org.trim(), count), null, 2)); }}>Generate Samples</button>
      <p>You can also paste finalized configuration objects below. Signing preserves their IDs and contents.</p>
      <textarea aria-label="Configurations JSON" value={text} disabled={busy || !!prepared} onChange={e => { reset(); setText(e.target.value); }} rows={16} style={{ width: '100%', fontFamily: 'monospace' }} />
      <button className="btn btn-primary" disabled={busy || !!prepared || !text || !connection?.etpEnabled} onClick={() => run(prepare)}>Prepare for Review</button>
    </section>
    {prepared && <section className="glass-panel" style={{ padding: 24, marginBottom: 24 }}>
      <h2>2. Review and Sign</h2><p>Review the locked JSON above. Sign All opens the Marketplace passphrase prompt once for this batch.</p>
      <p>Signing request: {prepared.signingId}</p>
      <button className="btn btn-primary" disabled={busy} onClick={() => run(sign)}>{busy ? 'Working…' : result ? 'Retrieve Signatures Again' : 'Sign All'}</button>{' '}
      <button className="btn btn-secondary" disabled={busy} onClick={reset}>Edit / Start New Batch</button>
    </section>}
    {result && <section className="glass-panel" style={{ padding: 24 }}>
      <h2>3. Signing Results</h2><p>{result.results.length} signatures returned through the integration backend. No Action1 objects were submitted.</p>
      <p>State: {result.state}. Expires: {new Date(result.expiresAt).toLocaleString()}</p>
      <pre style={{ overflow: 'auto', maxHeight: 500 }}>{JSON.stringify(result, null, 2)}</pre>
    </section>}
  </div>;
}
export const views = { dashboard: Dashboard };
