const zlib = require('zlib');

const PACKAGE_FORMATS = {
  windows: { directory: 'Windows', extension: 'msi' },
  macos: { directory: 'Mac', extension: 'pkg' },
  deb: { directory: 'Linux', extension: 'deb' },
  rpm: { directory: 'Linux', extension: 'rpm' }
};

function agentDownload(format, agentId, organizationName, consoleBaseUrl) {
  const packageFormat = PACKAGE_FORMATS[format];
  if (!packageFormat || !agentId || !organizationName) throw new Error('Agent package format, ID, and organization name are required.');
  const fileName = `agent(${organizationName}).${packageFormat.extension}`;
  const encodedFileName = encodeURIComponent(fileName).replace(/'/g, '%27');
  return {
    fileName,
    downloadUrl: `${String(consoleBaseUrl).replace(/\/+$/, '')}/agent/${encodeURIComponent(agentId)}/${packageFormat.directory}/${encodedFileName}`
  };
}

function macPkgMetadata(buffer) {
  if (buffer.length < 28 || buffer.toString('ascii', 0, 4) !== 'xar!') throw new Error('Action1 did not return a macOS PKG package.');
  const headerSize = buffer.readUInt16BE(4);
  const compressedLength = Number(buffer.readBigUInt64BE(8));
  if (headerSize < 28 || compressedLength <= 0 || headerSize + compressedLength > buffer.length) throw new Error('Action1 returned an invalid macOS PKG header.');
  const toc = zlib.inflateSync(buffer.subarray(headerSize, headerSize + compressedLength), { maxOutputLength: 16 * 1024 * 1024 }).toString('utf8');
  const heapStart = headerSize + compressedLength;
  for (const file of toc.matchAll(/<file\b[^>]*>([\s\S]*?)<\/file>/g)) {
    const entry = file[1];
    if (!/<name>(?:Distribution|PackageInfo)<\/name>/.test(entry)) continue;
    const offset = Number(entry.match(/<offset>(\d+)<\/offset>/)?.[1]);
    const length = Number(entry.match(/<length>(\d+)<\/length>/)?.[1]);
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || length <= 0 || length > 16 * 1024 * 1024 || heapStart + offset + length > buffer.length) continue;
    const data = buffer.subarray(heapStart + offset, heapStart + offset + length);
    const xml = /application\/x-gzip/.test(entry)
      ? zlib.inflateSync(data, { maxOutputLength: 16 * 1024 * 1024 }).toString('utf8')
      : data.toString('utf8');
    for (const match of xml.matchAll(/<(?:pkg-ref|pkg-info)\b([^>]*)>/g)) {
      const attributes = match[1];
      const bundleId = attributes.match(/\b(?:id|identifier)="([^"]+)"/)?.[1];
      const version = attributes.match(/\bversion="([^"]+)"/)?.[1];
      if (bundleId && version) return { bundleId, version };
    }
  }
  throw new Error('Action1 macOS PKG does not expose a package identifier and version for Intune detection.');
}

function linuxInstallScript(debUrl, rpmUrl) {
  for (const url of [debUrl, rpmUrl]) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.action1.com')) throw new Error('Linux agent downloads must use an Action1 HTTPS URL.');
  }
  const shellQuote = value => `'${value.replace(/'/g, `'\\''`)}'`;
  return `#!/bin/bash
set -euo pipefail
if [ -x /opt/action1/action1_agent ]; then exit 0; fi
if [ "$(id -u)" -ne 0 ]; then echo 'Action1 installer requires root.' >&2; exit 1; fi
workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT
if command -v apt-get >/dev/null 2>&1; then
  curl --fail --location --silent --show-error ${shellQuote(debUrl)} -o "$workdir/action1-agent.deb"
  DEBIAN_FRONTEND=noninteractive apt-get install -y "$workdir/action1-agent.deb"
elif command -v dnf >/dev/null 2>&1; then
  curl --fail --location --silent --show-error ${shellQuote(rpmUrl)} -o "$workdir/action1-agent.rpm"
  dnf -y install "$workdir/action1-agent.rpm"
elif command -v zypper >/dev/null 2>&1; then
  curl --fail --location --silent --show-error ${shellQuote(rpmUrl)} -o "$workdir/action1-agent.rpm"
  zypper --non-interactive install "$workdir/action1-agent.rpm"
elif command -v tdnf >/dev/null 2>&1; then
  curl --fail --location --silent --show-error ${shellQuote(rpmUrl)} -o "$workdir/action1-agent.rpm"
  tdnf -y install "$workdir/action1-agent.rpm"
else
  echo 'No supported DEB or RPM package manager was found.' >&2
  exit 1
fi
`;
}

function linuxPolicyBody(name, script) {
  const choice = (definition, suffix, instanceTemplateId, valueTemplateId) => ({
    settingInstance: {
      '@odata.type': '#microsoft.graph.deviceManagementConfigurationChoiceSettingInstance',
      settingDefinitionId: `linux_customconfig_${definition}`,
      settingInstanceTemplateReference: { settingInstanceTemplateId: instanceTemplateId },
      choiceSettingValue: {
        value: `linux_customconfig_${definition}_${suffix}`,
        children: [],
        settingValueTemplateReference: { settingValueTemplateId: valueTemplateId }
      }
    }
  });
  return {
    name,
    description: 'Installs the Action1 Agent on Intune-managed Linux devices.',
    platforms: 'linux',
    technologies: 'linuxMdm',
    roleScopeTagIds: ['0'],
    templateReference: { templateId: '92439f26-2b30-4503-8429-6d40f7e172dd_1' },
    settings: [
      choice('executioncontext', 'root', '2c59a6c5-e874-445b-ac5a-d53688ef838e', '119f0327-4114-444a-b53d-4b55fd579e43'),
      choice('executionfrequency', '1day', 'f42b866f-ff2b-4d19-bef8-63e7c763d49b', 'd0fb527e-606e-455f-891d-2a4de6a5db90'),
      choice('executionretries', '0', 'a3326517-152b-4b32-bc11-8772b5b4fe6a', '92b31053-6ebb-4d2d-9e4d-081fe15d5d21'),
      {
        settingInstance: {
          '@odata.type': '#microsoft.graph.deviceManagementConfigurationSimpleSettingInstance',
          settingDefinitionId: 'linux_customconfig_script',
          settingInstanceTemplateReference: { settingInstanceTemplateId: 'add4347a-f9aa-4202-a497-34a4c178d013' },
          simpleSettingValue: {
            '@odata.type': '#microsoft.graph.deviceManagementConfigurationStringSettingValue',
            value: Buffer.from(script).toString('base64'),
            settingValueTemplateReference: { settingValueTemplateId: '18dc8a98-2ecd-4753-8baf-3ab7a1d677a9' }
          }
        }
      }
    ]
  };
}

module.exports = { agentDownload, macPkgMetadata, linuxInstallScript, linuxPolicyBody };
