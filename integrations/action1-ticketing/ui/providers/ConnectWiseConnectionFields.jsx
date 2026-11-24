import React from 'react';

const PREFIX = 'TicketingProvider_connectwise_psa_';
const SECRET_MASK = '***';

function ConnectWiseConnectionFields({ settings = {}, setSettings, storedSecrets = {} }) {
  const value = (field) => String(settings[`${PREFIX}${field}`] ?? '');
  const update = (field, nextValue) => setSettings((current) => ({ ...current, [`${PREFIX}${field}`]: nextValue }));
  const region = value('ApiRegion');
  const common = { width: '100%', padding: '0.7rem', border: '1px solid var(--border-color)', borderRadius: 6, background: '#fff' };
  const fieldStyle = { display: 'grid', gap: '0.35rem', marginBottom: '0.9rem', fontWeight: 700 };
  return <div style={{ marginTop: '1rem', maxWidth: 620 }}>
    <label style={fieldStyle}>API Region / Server <span aria-hidden="true">*</span>
      <select aria-label="API Region / Server" required value={region} onChange={(event) => update('ApiRegion', event.target.value)} style={common}>
        <option value="">Select a server</option><option value="NA">North America</option><option value="EU">Europe</option><option value="AU">Australia</option><option value="CUSTOM">Custom Server</option>
      </select>
    </label>
    {region === 'CUSTOM' && <label style={fieldStyle}>Custom HTTPS Server <span aria-hidden="true">*</span>
      <input aria-label="Custom HTTPS Server" type="url" required placeholder="https://psa.example.com" value={value('CustomServer')} onChange={(event) => update('CustomServer', event.target.value)} style={common} />
    </label>}
    <label style={fieldStyle}>PSA Company ID <span aria-hidden="true">*</span>
      <input aria-label="PSA Company ID" required value={value('CompanyId')} onChange={(event) => update('CompanyId', event.target.value)} style={common} />
    </label>
    <label style={fieldStyle}>Public API Key <span aria-hidden="true">*</span>
      <input aria-label="Public API Key" required value={value('PublicApiKey')} onChange={(event) => update('PublicApiKey', event.target.value)} style={common} />
    </label>
    <label style={fieldStyle}>Private API Key <span aria-hidden="true">*</span>
      <input aria-label="Private API Key" required type="password" autoComplete="new-password" value={value('PrivateApiKey') === SECRET_MASK ? '' : value('PrivateApiKey')} placeholder={storedSecrets[`${PREFIX}PrivateApiKey`] || value('PrivateApiKey') === SECRET_MASK ? 'Saved (leave unchanged)' : ''} onFocus={() => { if (value('PrivateApiKey') === SECRET_MASK) update('PrivateApiKey', ''); }} onChange={(event) => update('PrivateApiKey', event.target.value)} style={common} />
    </label>
    <p style={{ margin: 0, color: '#526173', fontSize: '0.85rem' }}>ConnectWise API credentials are stored securely by Marketplace.</p>
  </div>;
}

export default ConnectWiseConnectionFields;
