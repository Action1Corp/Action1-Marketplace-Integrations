let axios;
let db;
let getSetting;
let getAction1Credentials;
let computeAndSaveRunMetrics;
let nvdService;



const crypto = require('crypto');
const zlib = require('zlib');
const { legacyPolicyFromSettings, normalizePolicy } = require('./policyStore');
const { agentDownload, macPkgMetadata, linuxInstallScript, linuxPolicyBody } = require('./agentPackages');

const ACTION1_APP_IMAGE_URL = 'https://www.action1.com/wp-content/uploads/2025/03/Action1_2560x1600.png';
const ACTION1_APP_INFORMATION_URL = 'https://www.action1.com/documentation/';
const ACTION1_APP_PRIVACY_URL = 'https://www.action1.com/legal/privacy-policy/';
const INTUNE_GRAPH_BASE = 'https://graph.microsoft.com/beta';
const ASSIGNMENT_MODE_ALL_DEVICES = 'allDevices';
const ASSIGNMENT_MODE_SELECTED_GROUPS = 'selectedGroups';
const ACTION1_AUTOMATION_ENDPOINT_RESULT_LIMIT = 500;
const ACTION1_AUTOMATION_PAGE_LIMIT = 10;
const ACTION1_AUTOMATION_INSTANCE_SCAN_LIMIT = 100;
const ACTION1_API_MAX_RETRIES = 5;
const ACTION1_API_BASE_BACKOFF_MS = 2000;
const ACTION1_API_MAX_BACKOFF_MS = 60000;
const ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE = 'Action1 Provisioning Status';
const ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE_VALUE = 'Completed';
const NO_AUTOMATION_RESULT_STATUS = 'No automation result';
const CONFIGURATION_MANAGER_REPORTING_TABLE = 'action1_configuration_manager_reporting';
const DEFAULT_ACTION1_BASE_URL = 'https://app.action1.com/api/3.0';
const DEFAULT_ACTION1_CONSOLE_URL = 'https://app.action1.com';

function action1BaseUrl(credentials = {}) {
    return String(credentials.baseUrl || DEFAULT_ACTION1_BASE_URL).replace(/\/+$/, '');
}

function action1ConsoleUrl(credentials = {}) {
    const configured = String(credentials.consoleUrl || '').trim().replace(/\/+$/, '');
    if (configured) return configured;
    try {
        return new URL(action1BaseUrl(credentials)).origin;
    } catch {
        return DEFAULT_ACTION1_CONSOLE_URL;
    }
}

function action1AutomationHistoryUrl(action1ConsoleBase, action1OrgId, instanceId) {
    const id = firstString(instanceId);
    const org = firstString(action1OrgId);
    if (!id || !org) return '';
    return `${String(action1ConsoleBase || DEFAULT_ACTION1_CONSOLE_URL).replace(/\/+$/, '')}/console/automations/history/${encodeURIComponent(id)}/details?limit=50&from=0&org=${encodeURIComponent(org)}`;
}


function updateProgress(details, status = 'Running') {
    console.log(`[Intune] ${details}`);
    return new Promise((resolve) => {
        const ts = new Date().toLocaleTimeString();
        db.get('SELECT id, details FROM sync_history WHERE integration_id = ? ORDER BY id DESC LIMIT 1', ['intune'], (err, row) => {
            if (row) {
                const newDetails = (row.details ? row.details + '\n' : '') + `${ts} - ${details}`;
                db.run('UPDATE sync_history SET status = ?, details = ? WHERE id = ?', [status, newDetails, row.id], resolve);
            } else resolve();
        });
    });
}

/** Extract ProductVersion from MSI binary buffer (UTF-16LE scan) */
function extractMsiVersion(buffer) {
    const versionPattern = /(\d+\.\d+\.\d+(?:\.\d+)?)/;
    const ascii = buffer.toString('latin1');
    const productIconMatch = ascii.match(/(\d+\.\d+\.\d+(?:\.\d+)?)ProductIcon/);
    if (productIconMatch) return productIconMatch[1];

    const productVersionUtf16 = Buffer.from('ProductVersion', 'utf16le');
    const productVersionAscii = Buffer.from('ProductVersion', 'latin1');

    for (const searchBuf of [productVersionUtf16, productVersionAscii]) {
        const idx = buffer.indexOf(searchBuf);
        if (idx === -1) continue;

        for (const encoding of ['utf16le', 'latin1']) {
            const region = buffer.slice(idx, Math.min(idx + 5000, buffer.length)).toString(encoding);
            const match = region.match(versionPattern);
            if (match) return match[1];
        }
    }

    const candidates = [...ascii.matchAll(versionPattern)]
        .map(match => match[1])
        .filter(version => !version.startsWith('10.0.') && !version.startsWith('6.0.') && !version.startsWith('6.1.') && !version.startsWith('3.14.'));

    return candidates[0] || null;
}

/** Extract ProductCode GUID from MSI binary buffer */
function extractMsiProductCode(buffer) {
    const searchBuf = Buffer.from('ProductCode', 'utf16le');
    let idx = buffer.indexOf(searchBuf);
    if (idx === -1) return null;
    const region = buffer.slice(idx, Math.min(idx + 500, buffer.length)).toString('utf16le');
    const m = region.match(/(\{[0-9A-Fa-f-]{36}\})/);
    return m ? m[1] : null;
}

function buildAction1AgentDownloadUrl(agentId, orgName, consoleBaseUrl = DEFAULT_ACTION1_CONSOLE_URL) {
    const msiFileName = `agent(${orgName}).msi`;
    return {
        msiFileName,
        downloadUrl: `${String(consoleBaseUrl || DEFAULT_ACTION1_CONSOLE_URL).replace(/\/+$/, '')}/agent/${encodeURIComponent(agentId)}/Windows/${encodeURIComponent(msiFileName)}`
    };
}

function safeFileName(value) {
    return String(value || '')
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
}

function buildIntuneAppName(orgName) {
    const label = String(orgName || '').trim();
    return label ? `Action1 Agent - ${label}` : 'Action1 Agent';
}

function normalizeIntuneAppName(value) {
    return String(value || '').trim().toLowerCase();
}

function isCommittedIntuneApp(app) {
    return !Object.prototype.hasOwnProperty.call(app || {}, 'committedContentVersion') || Boolean(app.committedContentVersion);
}

function compareIntuneAppsForRetention(a, b) {
    const aCommitted = isCommittedIntuneApp(a) ? 1 : 0;
    const bCommitted = isCommittedIntuneApp(b) ? 1 : 0;
    if (aCommitted !== bCommitted) return bCommitted - aCommitted;

    const versionCompare = compareVersions(String(b?.displayVersion || '0'), String(a?.displayVersion || '0'));
    if (versionCompare !== 0) return versionCompare;

    const aDate = Date.parse(a?.lastModifiedDateTime || a?.createdDateTime || '') || 0;
    const bDate = Date.parse(b?.lastModifiedDateTime || b?.createdDateTime || '') || 0;
    return bDate - aDate;
}

async function findManagedIntuneApp(graphHeaders, desiredAppName) {
    const desiredName = normalizeIntuneAppName(desiredAppName);
    const appsRes = await axios.get(
        `${INTUNE_GRAPH_BASE}/deviceAppManagement/mobileApps?$filter=isof('microsoft.graph.win32LobApp')`,
        { headers: graphHeaders }
    );
    const matches = (appsRes.data.value || [])
        .filter(app => normalizeIntuneAppName(app.displayName) === desiredName)
        .sort(compareIntuneAppsForRetention);

    const primary = matches.find(isCommittedIntuneApp) || null;
    const duplicateApps = matches.filter(app => !primary || app.id !== primary.id);
    return { primary, duplicateApps };
}

async function findManagedMacApp(graphHeaders, desiredAppName) {
    let nextUrl = `${INTUNE_GRAPH_BASE}/deviceAppManagement/mobileApps?$filter=isof('microsoft.graph.macOSPkgApp')`;
    const apps = [];
    while (nextUrl) {
        const response = await axios.get(nextUrl, { headers: graphHeaders });
        apps.push(...(response.data.value || []));
        nextUrl = response.data['@odata.nextLink'] || '';
    }
    return apps
        .filter(app => normalizeIntuneAppName(app.displayName) === normalizeIntuneAppName(desiredAppName))
        .sort(compareIntuneAppsForRetention)
        .find(isCommittedIntuneApp) || null;
}

async function deleteDuplicateIntuneApps(graphHeaders, desiredAppName, duplicateApps = []) {
    let deleted = 0;
    for (const app of duplicateApps) {
        if (!app?.id) continue;
        await updateProgress(`Removing duplicate Intune app "${app.displayName || desiredAppName}"...`);
        await deleteIntuneApp(graphHeaders, app.id);
        deleted += 1;
    }
    if (deleted > 0) {
        await updateProgress(`Removed ${deleted} duplicate Intune app${deleted === 1 ? '' : 's'} for "${desiredAppName}".`);
        await new Promise(r => setTimeout(r, 3000));
    }
    return deleted;
}

function assertMsiDownload(response, buffer) {
    const header = buffer.slice(0, 8).toString('hex');
    const oleCompoundFileHeader = 'd0cf11e0a1b11ae1';
    if (response.status && (response.status < 200 || response.status >= 300)) {
        throw new Error(`Action1 agent download returned HTTP ${response.status}. Check the Action1 Agent ID and organization name.`);
    }
    if (header !== oleCompoundFileHeader) {
        const contentType = response.headers?.['content-type'] || 'unknown';
        throw new Error(`Action1 agent download did not return an MSI file. Content-Type: ${contentType}. Check the Action1 Agent ID and organization name.`);
    }
}

async function getAction1LargeIcon() {
    try {
        const response = await axios.get(ACTION1_APP_IMAGE_URL, {
            responseType: 'arraybuffer',
            timeout: 30000,
            validateStatus: () => true
        });
        if (response.status < 200 || response.status >= 300) {
            await updateProgress(`Warning: Action1 app image returned HTTP ${response.status}. Continuing without app icon.`);
            return null;
        }

        const contentType = response.headers?.['content-type'] || 'image/png';
        if (!contentType.toLowerCase().startsWith('image/')) {
            await updateProgress(`Warning: Action1 app image returned ${contentType}. Continuing without app icon.`);
            return null;
        }

        return {
            "@odata.type": "#microsoft.graph.mimeContent",
            type: contentType.split(';')[0],
            value: Buffer.from(response.data).toString('base64')
        };
    } catch (error) {
        await updateProgress(`Warning: Could not download Action1 app image: ${error.message}. Continuing without app icon.`);
        return null;
    }
}

const CRC32_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
        let c = i;
        for (let j = 0; j < 8; j += 1) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[i] = c >>> 0;
    }
    return table;
})();

function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
    const year = Math.max(1980, date.getFullYear());
    const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { dosTime, dosDate };
}

function createZip(files) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    const { dosTime, dosDate } = dosDateTime();

    for (const file of files) {
        const nameBuffer = Buffer.from(file.name.replace(/\\/g, '/'), 'utf8');
        const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
        const compressed = zlib.deflateRawSync(data, { level: 9 });
        const checksum = crc32(data);

        const localHeader = Buffer.alloc(30);
        localHeader.writeUInt32LE(0x04034b50, 0);
        localHeader.writeUInt16LE(20, 4);
        localHeader.writeUInt16LE(0x0800, 6);
        localHeader.writeUInt16LE(8, 8);
        localHeader.writeUInt16LE(dosTime, 10);
        localHeader.writeUInt16LE(dosDate, 12);
        localHeader.writeUInt32LE(checksum, 14);
        localHeader.writeUInt32LE(compressed.length, 18);
        localHeader.writeUInt32LE(data.length, 22);
        localHeader.writeUInt16LE(nameBuffer.length, 26);
        localHeader.writeUInt16LE(0, 28);
        localParts.push(localHeader, nameBuffer, compressed);

        const centralHeader = Buffer.alloc(46);
        centralHeader.writeUInt32LE(0x02014b50, 0);
        centralHeader.writeUInt16LE(20, 4);
        centralHeader.writeUInt16LE(20, 6);
        centralHeader.writeUInt16LE(0x0800, 8);
        centralHeader.writeUInt16LE(8, 10);
        centralHeader.writeUInt16LE(dosTime, 12);
        centralHeader.writeUInt16LE(dosDate, 14);
        centralHeader.writeUInt32LE(checksum, 16);
        centralHeader.writeUInt32LE(compressed.length, 20);
        centralHeader.writeUInt32LE(data.length, 24);
        centralHeader.writeUInt16LE(nameBuffer.length, 28);
        centralHeader.writeUInt16LE(0, 30);
        centralHeader.writeUInt16LE(0, 32);
        centralHeader.writeUInt16LE(0, 34);
        centralHeader.writeUInt16LE(0, 36);
        centralHeader.writeUInt32LE(0, 38);
        centralHeader.writeUInt32LE(offset, 42);
        centralParts.push(centralHeader, nameBuffer);

        offset += localHeader.length + nameBuffer.length + compressed.length;
    }

    const centralDirectory = Buffer.concat(centralParts);
    const endRecord = Buffer.alloc(22);
    endRecord.writeUInt32LE(0x06054b50, 0);
    endRecord.writeUInt16LE(0, 4);
    endRecord.writeUInt16LE(0, 6);
    endRecord.writeUInt16LE(files.length, 8);
    endRecord.writeUInt16LE(files.length, 10);
    endRecord.writeUInt32LE(centralDirectory.length, 12);
    endRecord.writeUInt32LE(offset, 16);
    endRecord.writeUInt16LE(0, 20);

    return Buffer.concat([...localParts, centralDirectory, endRecord]);
}

function createIntuneWinInnerPackage(msiBuffer, msiFileName) {
    return createZip([{ name: msiFileName, data: msiBuffer }]);
}

/** Encrypt file buffer for Intune content upload */
function encryptForIntune(fileBuffer) {
    const encKey = crypto.randomBytes(32);
    const hmacKey = crypto.randomBytes(32);
    const iv = crypto.randomBytes(16);

    const cipher = crypto.createCipheriv('aes-256-cbc', encKey, iv);
    const encrypted = Buffer.concat([cipher.update(fileBuffer), cipher.final()]);

    const hmac = crypto.createHmac('sha256', hmacKey);
    hmac.update(iv);
    hmac.update(encrypted);
    const mac = hmac.digest();
    const uploadData = Buffer.concat([mac, iv, encrypted]);

    const fileDigest = crypto.createHash('sha256').update(fileBuffer).digest('base64');

    return {
        uploadData,
        encryptionInfo: {
            encryptionKey: encKey.toString('base64'),
            macKey: hmacKey.toString('base64'),
            initializationVector: iv.toString('base64'),
            mac: mac.toString('base64'),
            profileIdentifier: 'ProfileVersion1',
            fileDigest: fileDigest,
            fileDigestAlgorithm: 'SHA256'
        },
        sizeEncrypted: uploadData.length,
        sizeOriginal: fileBuffer.length
    };
}

/** Upload encrypted content to Azure Storage in chunks */
async function uploadToAzureStorage(sasUri, data) {
    const CHUNK = 6 * 1024 * 1024; // 6 MB chunks
    const blockIds = [];

    for (let i = 0; i < data.length; i += CHUNK) {
        const chunk = data.slice(i, Math.min(i + CHUNK, data.length));
        const blockId = Buffer.from(String(blockIds.length).padStart(6, '0')).toString('base64');
        blockIds.push(blockId);

        await axios.put(`${sasUri}&comp=block&blockid=${encodeURIComponent(blockId)}`, chunk, {
            headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': chunk.length },
            maxBodyLength: Infinity, maxContentLength: Infinity
        });
    }

    // Commit block list
    const blockListXml = `<?xml version="1.0" encoding="utf-8"?><BlockList>${blockIds.map(id => `<Latest>${id}</Latest>`).join('')}</BlockList>`;
    await axios.put(`${sasUri}&comp=blocklist`, blockListXml, {
        headers: { 'Content-Type': 'application/xml' }
    });
}

const FAILED_UPLOAD_STATES = new Set([
    'azureStorageUriRequestFailed',
    'azureStorageUriRenewalFailed',
    'commitFileFailed'
]);

/** Wait for a file's uploadState to satisfy a condition */
async function waitForFileState(graphHeaders, fileUrl, description, isReady, maxWait = 300) {
    let lastState = 'unknown';
    for (let i = 0; i < maxWait; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const res = await axios.get(fileUrl, { headers: graphHeaders });
        lastState = res.data.uploadState || 'unknown';
        if (isReady(res.data)) return res.data;
        if (FAILED_UPLOAD_STATES.has(lastState)) {
            throw new Error(`Upload failed with state: ${lastState}`);
        }
        if (i > 0 && i % 15 === 0) {
            await updateProgress(`Waiting for Intune ${description}... current state: ${lastState}`);
        }
    }
    throw new Error(`Timeout waiting for Intune ${description}. Last state: ${lastState}`);
}

async function deleteIntuneApp(graphHeaders, appId) {
    await axios.delete(`${INTUNE_GRAPH_BASE}/deviceAppManagement/mobileApps/${appId}`, { headers: graphHeaders });
}

function parseSelectedGroupIds(value) {
    if (Array.isArray(value)) return value.map(String).map(item => item.trim()).filter(Boolean);
    const text = String(value || '').trim();
    if (!text) return [];
    try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) return parsed.map(String).map(item => item.trim()).filter(Boolean);
    } catch {}
    return text.split(',').map(item => item.trim()).filter(Boolean);
}

function parseSelectedGroupMap(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    const text = String(value || '').trim();
    if (!text) return {};
    try {
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {}
    return {};
}

async function getEnrollmentPoliciesForSync() {
    const rawPolicies = await getSetting('IntuneEnrollmentPolicies');
    const settings = {
        IntuneAction1OrgId: await getSetting('IntuneAction1OrgId'),
        IntuneAgentId: await getSetting('IntuneAgentId'),
        IntuneOrgName: await getSetting('IntuneOrgName'),
        IntuneAssignmentTargetMode: await getSetting('IntuneAssignmentTargetMode'),
        IntuneDeviceGroupIds: await getSetting('IntuneDeviceGroupIds'),
        IntuneDeviceGroupMap: await getSetting('IntuneDeviceGroupMap'),
        IntuneProvisioningAction1GroupIds: await getSetting('IntuneProvisioningAction1GroupIds'),
        IntuneProvisioningAction1GroupMap: await getSetting('IntuneProvisioningAction1GroupMap')
    };
    try {
        const parsed = JSON.parse(rawPolicies || '[]');
        if (String(rawPolicies || '').trim()) {
            return Array.isArray(parsed)
                ? parsed.map(policy => normalizePolicy({
                    ...policy,
                    agentDownloadOrgName: policy.agentDownloadOrgName || settings.IntuneAgentDownloadOrgName || settings.IntuneOrgName || policy.organizationName
                })).filter(policy => policy.enabled !== false)
                : [];
        }
    } catch {}
    const legacyPolicy = legacyPolicyFromSettings(settings);
    return legacyPolicy ? [legacyPolicy] : [];
}

function normalizeAssignmentMode(value) {
    return value === ASSIGNMENT_MODE_SELECTED_GROUPS ? ASSIGNMENT_MODE_SELECTED_GROUPS : ASSIGNMENT_MODE_ALL_DEVICES;
}

function buildAssignmentSettings() {
    return {
        "@odata.type": "#microsoft.graph.win32LobAppAssignmentSettings",
        notifications: "showAll",
        deliveryOptimizationPriority: "notConfigured",
        installTimeSettings: null,
        restartSettings: null
    };
}

function buildRequiredAssignment(target, platform = 'windows') {
    const assignment = {
        "@odata.type": "#microsoft.graph.mobileAppAssignment",
        intent: "required",
        target
    };
    if (platform !== 'macos') assignment.settings = buildAssignmentSettings();
    return assignment;
}

function buildDesiredAssignments(mode, selectedGroupIds, platform = 'windows') {
    if (mode === ASSIGNMENT_MODE_SELECTED_GROUPS) {
        if (selectedGroupIds.length === 0) {
            throw new Error('Select at least one Intune device group, or choose All devices.');
        }
        return selectedGroupIds.map(groupId => buildRequiredAssignment({
            "@odata.type": "#microsoft.graph.groupAssignmentTarget",
            groupId
        }, platform));
    }

    return [buildRequiredAssignment({
        "@odata.type": "#microsoft.graph.allDevicesAssignmentTarget"
    }, platform)];
}

function describeDesiredAssignments(mode, selectedGroupIds) {
    return mode === ASSIGNMENT_MODE_SELECTED_GROUPS
        ? `${selectedGroupIds.length} selected device group${selectedGroupIds.length === 1 ? '' : 's'}`
        : 'All devices';
}

async function assignIntuneApp(graphHeaders, appId, mode, selectedGroupIds, platform = 'windows') {
    const desired = buildDesiredAssignments(mode, selectedGroupIds, platform);
    await axios.post(`${INTUNE_GRAPH_BASE}/deviceAppManagement/mobileApps/${appId}/assign`, {
        mobileAppAssignments: desired
    }, { headers: graphHeaders });
    if (platform !== 'macos') return;

    const assignmentsUrl = `${INTUNE_GRAPH_BASE}/deviceAppManagement/mobileApps/${appId}/assignments`;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const response = await axios.get(assignmentsUrl, { headers: graphHeaders });
        const actual = response.data.value || [];
        const matches = desired.every(expected => actual.some(item =>
            item.intent === expected.intent &&
            item.target?.['@odata.type'] === expected.target['@odata.type'] &&
            item.target?.groupId === expected.target.groupId
        ));
        if (matches && actual.length === desired.length) return;
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error('Intune accepted the macOS app assignment request but did not retain the selected groups.');
}

function organizationKey(policy) {
    return String(policy.organizationId || policy.organizationName || '').trim().toLowerCase();
}

function buildOrganizationPlatformPlans(policies) {
    const plans = new Map();
    for (const policy of policies) {
        const key = organizationKey(policy);
        if (!plans.has(key)) plans.set(key, new Map());
        const platforms = plans.get(key);
        for (const platform of policy.platforms || ['windows']) {
            const existing = platforms.get(platform);
            if (!existing) {
                platforms.set(platform, {
                    ...policy,
                    platforms: [platform],
                    intuneDeviceGroupIds: [...new Set(policy.intuneDeviceGroupIds || [])]
                });
                continue;
            }
            existing.intuneDeviceGroupIds = [...new Set([...existing.intuneDeviceGroupIds, ...(policy.intuneDeviceGroupIds || [])])];
            if (normalizeAssignmentMode(policy.assignmentMode) === ASSIGNMENT_MODE_ALL_DEVICES) {
                existing.assignmentMode = ASSIGNMENT_MODE_ALL_DEVICES;
            }
        }
    }
    return plans;
}

function normalizeEndpointName(value) {
    return String(value || '').trim().split('.')[0].toLowerCase();
}

function firstString(...values) {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
}

function dbGet(sql, params = []) {
    return new Promise((resolve) => {
        if (!db?.get) return resolve(null);
        db.get(sql, params, (error, row) => resolve(error ? null : row));
    });
}

function configurationPolicyFromAutomationName(automationName) {
    const text = String(automationName || '').trim();
    if (!/^A1CM\b/i.test(text)) return null;
    const match = text.match(/\bPOL-\d{6,}\b/i);
    if (!match) return null;
    return match[0].toUpperCase();
}

function configurationPolicyNameFromAutomationName(automationName) {
    const text = String(automationName || '').trim();
    const policyId = configurationPolicyFromAutomationName(text);
    if (!policyId) return '';
    const parts = text.split(/\s+[—-]\s+/).map(part => part.trim()).filter(Boolean);
    const policyIndex = parts.findIndex(part => part.toUpperCase() === policyId);
    if (policyIndex >= 0 && parts[policyIndex + 1]) return parts[policyIndex + 1];
    return '';
}

function endpointCustomAttributeValue(endpoint, attributeName) {
    const customKey = `custom:${attributeName}`;
    const directValue = firstString(endpoint?.[customKey], endpoint?.[customKey.toLowerCase()], endpoint?.[attributeName]);
    if (directValue) return directValue;

    const containers = [
        endpoint?.custom_attributes,
        endpoint?.customAttributes,
        endpoint?.custom,
        endpoint?.attributes
    ];

    for (const container of containers) {
        if (!container) continue;
        if (Array.isArray(container)) {
            for (const attribute of container) {
                const name = firstString(attribute?.name, attribute?.field_name, attribute?.fieldName, attribute?.key, attribute?.id);
                if (name.toLowerCase() === attributeName.toLowerCase() || name.toLowerCase() === customKey.toLowerCase()) {
                    return firstString(attribute?.value, attribute?.field_value, attribute?.fieldValue, attribute?.text);
                }
            }
            continue;
        }
        if (typeof container === 'object') {
            const objectValue = firstString(container[attributeName], container[customKey], container[customKey.toLowerCase()]);
            if (objectValue) return objectValue;
        }
    }
    return '';
}

function hasCompletedProvisioningAttribute(endpoint) {
    return endpointCustomAttributeValue(endpoint, ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE).toLowerCase() ===
        ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE_VALUE.toLowerCase();
}

function formatEndpointDate(value) {
    if (!value) return '';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function retryAfterMs(headers) {
    const retryAfter = headers?.['retry-after'] || headers?.['Retry-After'];
    if (!retryAfter) return 0;
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const retryDate = new Date(retryAfter);
    const delta = retryDate.getTime() - Date.now();
    return Number.isFinite(delta) ? Math.max(0, delta) : 0;
}

function action1BackoffDelay(error, attempt) {
    const fromHeader = retryAfterMs(error?.response?.headers);
    if (fromHeader > 0) return Math.min(fromHeader, ACTION1_API_MAX_BACKOFF_MS);
    const exponential = ACTION1_API_BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
    const jitter = Math.floor(Math.random() * 1000);
    return Math.min(exponential + jitter, ACTION1_API_MAX_BACKOFF_MS);
}

async function requestAction1(config, label = 'Action1 API request') {
    let lastError;
    for (let attempt = 1; attempt <= ACTION1_API_MAX_RETRIES + 1; attempt += 1) {
        try {
            if (typeof axios.request === 'function') return await axios.request(config);
            return await axios(config);
        } catch (error) {
            lastError = error;
            const status = error?.response?.status;
            const shouldRetry = status === 429 || status === 503 || status === 504;
            if (!shouldRetry || attempt > ACTION1_API_MAX_RETRIES) break;
            const delay = action1BackoffDelay(error, attempt);
            await updateProgress(`${label} returned HTTP ${status}. Retrying in ${Math.ceil(delay / 1000)}s (${attempt}/${ACTION1_API_MAX_RETRIES})...`);
            await sleep(delay);
        }
    }
    throw lastError;
}

async function fetchGraphCollection(graphHeaders, url) {
    const rows = [];
    let nextUrl = url;
    while (nextUrl) {
        const response = await axios.get(nextUrl, { headers: graphHeaders });
        rows.push(...(response.data?.value || []));
        nextUrl = response.data?.['@odata.nextLink'] || '';
    }
    return rows;
}

async function getAction1Headers(action1ApiKey, action1ApiSecret, action1ApiBase = DEFAULT_ACTION1_BASE_URL) {
    const tokenParams = new URLSearchParams();
    tokenParams.append('client_id', action1ApiKey);
    tokenParams.append('client_secret', action1ApiSecret);
    tokenParams.append('grant_type', 'client_credentials');
    const tokenRes = await requestAction1({
        method: 'post',
        url: `${action1ApiBase}/oauth2/token`,
        data: tokenParams,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    }, 'Action1 token request');
    return { Authorization: `Bearer ${tokenRes.data.access_token}`, Accept: 'application/json' };
}

async function fetchAction1ManagedEndpoints(action1ApiKey, action1ApiSecret, action1OrgId, action1ApiBase = DEFAULT_ACTION1_BASE_URL) {
    const headers = await getAction1Headers(action1ApiKey, action1ApiSecret, action1ApiBase);
    const response = await requestAction1({
        method: 'get',
        url: `${action1ApiBase}/endpoints/managed/${action1OrgId}?limit=9999`,
        headers
    }, 'Action1 managed endpoints request');
    const payload = response.data;
    if (Array.isArray(payload)) return payload;
    return payload.items || payload.data || payload.endpoints || [];
}

function action1Items(payload) {
    if (Array.isArray(payload)) return payload;
    return payload?.items || payload?.data || payload?.results || payload?.rows || [];
}

async function fetchAction1Collection(headers, firstUrl, { limit = 500, pageLimit = ACTION1_AUTOMATION_PAGE_LIMIT, action1ApiBase = DEFAULT_ACTION1_BASE_URL } = {}) {
    const rows = [];
    let url = firstUrl;
    let pages = 0;
    while (url && pages < pageLimit) {
        const response = await requestAction1({
            method: 'get',
            url,
            headers
        }, 'Action1 collection request');
        const payload = response.data || {};
        const items = action1Items(payload);
        rows.push(...items);
        pages += 1;

        const nextUrl = payload.next || payload.next_link || payload.nextLink || '';
        if (nextUrl) {
            url = String(nextUrl).startsWith('http') ? nextUrl : `${action1ApiBase}${nextUrl}`;
            continue;
        }

        const from = Number(payload.from);
        const total = Number(payload.total_items ?? payload.totalItems ?? payload.total);
        if (Number.isFinite(from) && Number.isFinite(total) && from + items.length < total && items.length > 0) {
            const nextFrom = from + items.length;
            url = firstUrl.replace(/([?&])from=\d+/, `$1from=${nextFrom}`);
            if (url === firstUrl && !/[?&]from=/.test(url)) url += `${url.includes('?') ? '&' : '?'}from=${nextFrom}`;
            if (!/[?&]limit=/.test(url)) url += `${url.includes('?') ? '&' : '?'}limit=${limit}`;
            continue;
        }
        break;
    }
    return rows;
}

function normalizeAutomationStatus(row, instance) {
    const raw = firstString(row?.status, row?.last_status, row?.lastStatus, row?.state, instance?.status, instance?.last_status);
    const normalized = raw.toLowerCase().replace(/[_-]+/g, ' ');
    if (/(error|fail|failed|failure|cancel|canceled|cancelled|timeout|stopped|aborted)/.test(normalized)) return 'Failed';
    if (/(running|progress|pending|queued|waiting|started|starting|processing|scheduled|not started)/.test(normalized)) return 'In progress';
    if (/(success|succeed|succeeded|completed|complete|done|ok)/.test(normalized)) return 'Completed';
    if (instance && (instance.completed === false || String(instance.completed || '').toLowerCase() === 'no')) return 'In progress';
    return '';
}

function automationResultTime(result) {
    const raw = firstString(result?.startedAt, result?.completedAt);
    if (!raw) return 0;
    const normalized = raw.replace(/^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})$/, '$1T$2:$3:$4Z');
    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
}

function latestProvisioningResults(results) {
    const latestByAutomation = new Map();
    for (const result of results) {
        const automationKey = automationResultIdentity(result) || 'unnamed automation';
        const current = latestByAutomation.get(automationKey);
        const resultCompleted = result?.status === 'Completed';
        const currentCompleted = current?.status === 'Completed';
        if (
            !current ||
            (resultCompleted && !currentCompleted) ||
            (resultCompleted === currentCompleted && automationResultTime(result) >= automationResultTime(current))
        ) {
            latestByAutomation.set(automationKey, result);
        }
    }
    return Array.from(latestByAutomation.values()).sort((a, b) => automationResultTime(b) - automationResultTime(a));
}

function automationResultIdentity(result) {
    return String(result?.scheduleId || result?.scheduleKey || result?.automationName || '').trim().toLowerCase();
}

function mergeStickyCompletedAutomationResults(currentResults = [], previousResults = []) {
    const previousCompletedByIdentity = new Map();
    for (const result of previousResults) {
        if (result?.status !== 'Completed') continue;
        const identity = automationResultIdentity(result);
        if (!identity) continue;
        const current = previousCompletedByIdentity.get(identity);
        if (!current || automationResultTime(result) >= automationResultTime(current)) {
            previousCompletedByIdentity.set(identity, result);
        }
    }

    return currentResults.map(result => {
        if (result?.status === 'Completed') return result;
        const previousCompleted = previousCompletedByIdentity.get(automationResultIdentity(result));
        return previousCompleted || result;
    });
}

function normalizeConfigurationStatus(value) {
    const text = String(value || '').trim();
    const normalized = text.toLowerCase().replace(/[\s_-]+/g, '');
    if (normalized === 'compliant') return 'Compliant';
    if (normalized === 'noncompliant' || normalized === 'noncompliance') return 'NonCompliant';
    if (/(fail|error|noncompliant|notcompliant)/.test(normalized)) return 'NonCompliant';
    if (/(pending|progress|unknown|notchecked|nostatus)/.test(normalized)) return 'Unknown';
    return text || 'Unknown';
}

function normalizeConfigurationControlRow(row) {
    const fields = row?.fields || row || {};
    const status = normalizeConfigurationStatus(fields['Configuration Status'] || fields.configurationStatus || fields.status);
    const policyId = firstString(fields['Policy ID'], fields.policyId, fields.policy_id).toUpperCase();
    const policyName = firstString(fields['Policy Name'], fields.policyName, fields.policy_name);
    const controlName = firstString(fields['Control Name'], fields.controlName, fields.control_name);
    const controlVersion = firstString(fields['Control Version'], fields.controlVersion, fields.control_version);
    const endpointName = firstString(fields['Endpoint Name'], fields.endpointName, fields.endpoint_name);
    const message = firstString(fields.Message, fields.message, fields.Details, fields.details);
    const lastCheckedAt = firstString(fields['Last Checked At'], fields.lastCheckedAt, fields.last_checked_at);
    const lastRemediatedAt = firstString(fields['Last Remediated At'], fields.lastRemediatedAt, fields.last_remediated_at);
    const remediationAttempted = firstString(fields['Remediation Attempted'], fields.remediationAttempted, fields.remediation_attempted);
    if (!policyId) return null;
    return {
        status,
        policyId,
        policyName,
        controlName,
        controlVersion,
        endpointName,
        message,
        lastCheckedAt,
        lastRemediatedAt,
        remediationAttempted
    };
}

function summarizeConfigurationPolicyControls(policyId, controls = []) {
    const policyControls = controls.filter(control => control.policyId === policyId);
    if (!policyControls.length) {
        return {
            status: 'Unknown',
            detail: 'No Configuration Management report rows were found for this policy and endpoint.',
            controls: [],
            nonCompliantControls: []
        };
    }
    const nonCompliantControls = policyControls.filter(control => control.status !== 'Compliant');
    if (nonCompliantControls.length) {
        return {
            status: 'NonCompliant',
            detail: `${nonCompliantControls.length} configuration control${nonCompliantControls.length === 1 ? '' : 's'} not compliant.`,
            controls: policyControls,
            nonCompliantControls
        };
    }
    return {
        status: 'Compliant',
        detail: 'All Configuration Management controls for this policy are compliant.',
        controls: policyControls,
        nonCompliantControls: []
    };
}

function action1GroupIds(items = []) {
    return (Array.isArray(items) ? items : [])
        .filter(item => String(item?.type || '').toLowerCase() === 'endpointgroup' || item?.id)
        .map(item => String(item?.id || item?.group_id || item?.groupId || '').trim())
        .filter(Boolean);
}

function action1InstanceGroupIds(instance) {
    return action1GroupIds(instance?.endpoints || instance?.endpoint_groups || instance?.endpointGroups || instance?.targets);
}

function action1InstanceScheduleKey(instance) {
    const scheduleUrl = firstString(instance?.schedule);
    if (scheduleUrl) return scheduleUrl;
    const instanceId = firstString(instance?.id, instance?.instance_id, instance?.instanceId);
    return instanceId.replace(/_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/, '') || firstString(instance?.name, 'Unnamed automation');
}

function parseAction1Time(value) {
    const raw = firstString(value);
    if (!raw) return 0;
    const normalized = raw.replace(/^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})$/, '$1T$2:$3:$4Z');
    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
}

function action1InstanceTime(instance) {
    return parseAction1Time(firstString(instance?.start_time, instance?.startTime, instance?.end_time, instance?.endTime));
}

function action1ScheduleFrequencyMinutes(schedule, instance) {
    const settings = firstString(schedule?.settings);
    const everyMatch = settings.match(/\bEVERY:(\d+)\b/i);
    if (everyMatch) return Number(everyMatch[1]);

    const lastRun = parseAction1Time(schedule?.last_run || schedule?.lastRun);
    const nextRun = parseAction1Time(schedule?.next_run || schedule?.nextRun);
    if (lastRun && nextRun && nextRun > lastRun) return Math.round((nextRun - lastRun) / 60000);

    const retryMinutes = Number(firstString(schedule?.retry_minutes, schedule?.retryMinutes, instance?.retry_minutes, instance?.retryMinutes));
    return Number.isFinite(retryMinutes) && retryMinutes > 0 ? retryMinutes : null;
}

async function fetchAction1Schedule(headers, scheduleUrl) {
    if (!scheduleUrl) return null;
    const response = await requestAction1({
        method: 'get',
        url: scheduleUrl,
        headers
    }, 'Action1 automation schedule request');
    return response.data || null;
}

async function removeAction1EndpointFromGroup(headers, action1OrgId, groupId, endpointId, action1ApiBase = DEFAULT_ACTION1_BASE_URL) {
    const response = await requestAction1({
        method: 'post',
        url: `${action1ApiBase}/endpoints/groups/${encodeURIComponent(action1OrgId)}/${encodeURIComponent(groupId)}/contents`,
        headers: { ...headers, 'Content-Type': 'application/json' },
        data: [{ method: 'DELETE', endpoint_id: endpointId }]
    }, 'Action1 endpoint group removal request');
    return response.data || {};
}

async function ensureAction1ProvisioningCustomAttribute(headers, action1ApiBase = DEFAULT_ACTION1_BASE_URL) {
    const settings = await fetchAction1Collection(
        headers,
        `${action1ApiBase}/settings/all?limit=100&from=0`,
        { limit: 100, pageLimit: 5, action1ApiBase }
    );
    const setting = settings.find(item => (
        item?.template_id === 'endpoint_custom_attributes' ||
        String(item?.name || '').toLowerCase() === 'endpoint custom attributes'
    ));
    const desired = ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE;
    if (setting) {
        let attributes = [];
        try {
            attributes = JSON.parse(setting.value || '[]');
        } catch {
            attributes = [];
        }
        if (attributes.some(attribute => String(attribute?.name || '').trim().toLowerCase() === desired.toLowerCase())) {
            return { changed: false, message: `${desired} custom attribute already exists.` };
        }
        const updatedAttributes = [...attributes, { name: desired }];
        await requestAction1({
            method: 'patch',
            url: `${action1ApiBase}/settings/all/${encodeURIComponent(setting.id)}`,
            headers: { ...headers, 'Content-Type': 'application/json' },
            data: {
                value: JSON.stringify(updatedAttributes),
                scope: setting.scope || [{ type: 'Enterprise', object: 'All' }]
            }
        }, 'Action1 custom attribute settings request');
        return { changed: true, message: `${desired} custom attribute was added.` };
    }

    await requestAction1({
        method: 'post',
        url: `${action1ApiBase}/settings/all`,
        headers: { ...headers, 'Content-Type': 'application/json' },
        data: {
            template_id: 'endpoint_custom_attributes',
            value: JSON.stringify([{ name: desired }]),
            scope: [{ type: 'Enterprise', object: 'All' }]
        }
    }, 'Action1 custom attribute settings request');
    return { changed: true, message: `${desired} custom attribute setting was created.` };
}

async function setAction1EndpointProvisioningAttribute(headers, action1OrgId, endpointId, action1ApiBase = DEFAULT_ACTION1_BASE_URL) {
    const response = await requestAction1({
        method: 'patch',
        url: `${action1ApiBase}/endpoints/managed/${encodeURIComponent(action1OrgId)}/${encodeURIComponent(endpointId)}`,
        headers: { ...headers, 'Content-Type': 'application/json' },
        data: {
            [`custom:${ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE}`]: ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE_VALUE
        }
    }, 'Action1 endpoint custom attribute request');
    return response.data || {};
}

async function selectLatestProvisioningInstances(headers, instances, selectedAction1GroupIds = []) {
    const selectedGroupSet = new Set(selectedAction1GroupIds.map(id => String(id || '').trim()).filter(Boolean));
    if (!selectedGroupSet.size) return [];

    const scheduleCache = new Map();
    const latestBySchedule = new Map();

    for (const instance of instances) {
        const scheduleUrl = firstString(instance?.schedule);
        if (!scheduleUrl) continue;
        const scheduleKey = action1InstanceScheduleKey(instance);
        let schedule = scheduleCache.get(scheduleKey);
        if (!schedule && scheduleUrl) {
            try {
                schedule = await fetchAction1Schedule(headers, scheduleUrl);
            } catch {
                schedule = null;
            }
            scheduleCache.set(scheduleKey, schedule || null);
        }
        if (!schedule) continue;

        const scheduleGroups = action1GroupIds(schedule?.endpoints || schedule?.endpoint_groups || schedule?.endpointGroups || schedule?.targets);
        if (!scheduleGroups.some(groupId => selectedGroupSet.has(groupId))) continue;

        const frequencyMinutes = action1ScheduleFrequencyMinutes(schedule, instance);
        const current = latestBySchedule.get(scheduleKey);
        if (!current || action1InstanceTime(instance) >= action1InstanceTime(current.instance)) {
            latestBySchedule.set(scheduleKey, {
                instance,
                schedule,
                frequencyMinutes,
                scheduleGroupIds: scheduleGroups
            });
        }
    }

    return Array.from(latestBySchedule.values()).sort((a, b) => action1InstanceTime(b.instance) - action1InstanceTime(a.instance));
}

async function fetchProvisioningSchedules(headers, action1OrgId, selectedAction1GroupIds = [], action1ApiBase = DEFAULT_ACTION1_BASE_URL) {
    const selectedGroupSet = new Set(selectedAction1GroupIds.map(id => String(id || '').trim()).filter(Boolean));
    if (!selectedGroupSet.size) return [];

    const schedules = await fetchAction1Collection(
        headers,
        `${action1ApiBase}/automations/schedules/${encodeURIComponent(action1OrgId)}?limit=500&from=0`,
        { limit: 500, pageLimit: 10, action1ApiBase }
    );

    return schedules
        .map(schedule => {
            const scheduleGroupIds = action1GroupIds(schedule?.endpoints || schedule?.endpoint_groups || schedule?.endpointGroups || schedule?.targets);
            return {
                schedule,
                scheduleId: firstString(schedule?.id, schedule?.schedule_id, schedule?.scheduleId),
                scheduleName: firstString(schedule?.name, schedule?.displayName, schedule?.display_name),
                scheduleGroupIds,
                frequencyMinutes: action1ScheduleFrequencyMinutes(schedule)
            };
        })
        .filter(item => item.scheduleId && item.scheduleGroupIds.some(groupId => selectedGroupSet.has(groupId)));
}

function action1InstanceId(instance) {
    return firstString(instance?.id, instance?.instance_id, instance?.instanceId);
}

function action1InstanceName(instance) {
    return firstString(instance?.name, instance?.action_name, instance?.automation_name);
}

function instanceMatchesSchedule(instance, provisioningSchedule) {
    const scheduleId = firstString(provisioningSchedule?.scheduleId);
    const scheduleName = firstString(provisioningSchedule?.scheduleName);
    const instanceId = action1InstanceId(instance);
    const instanceName = action1InstanceName(instance);
    const scheduleUrl = firstString(instance?.schedule);

    if (scheduleId && scheduleUrl.includes(`/${scheduleId}`)) return true;
    if (scheduleId && instanceId === scheduleId) return true;
    if (scheduleId && instanceId.startsWith(`${scheduleId}_`)) return true;
    if (scheduleName && (instanceName === scheduleName || instanceName.startsWith(`${scheduleName} - `))) return true;
    return false;
}

function latestInstanceForSchedule(instances, provisioningSchedule) {
    return instancesForSchedule(instances, provisioningSchedule)[0] || null;
}

function instancesForSchedule(instances, provisioningSchedule) {
    return (instances || [])
        .filter(instance => instanceMatchesSchedule(instance, provisioningSchedule))
        .sort((a, b) => action1InstanceTime(b) - action1InstanceTime(a));
}

async function getConfigurationManagerByEndpointReportId() {
    const row = await dbGet(
        `SELECT report_by_endpoint FROM ${CONFIGURATION_MANAGER_REPORTING_TABLE} WHERE singleton_id = 1`
    );
    return firstString(row?.report_by_endpoint);
}

async function requeryConfigurationManagerReport(headers, action1OrgId, reportId, action1ApiBase = DEFAULT_ACTION1_BASE_URL) {
    if (!reportId) return false;
    await requestAction1({
        method: 'post',
        url: `${action1ApiBase}/reportdata/${encodeURIComponent(action1OrgId)}/${encodeURIComponent(reportId)}/requery`,
        headers
    }, 'Action1 Configuration Management report refresh request');
    return true;
}

async function fetchConfigurationPolicyControlsForEndpoints(headers, action1OrgId, reportId, endpointNames = [], action1ApiBase = DEFAULT_ACTION1_BASE_URL) {
    const result = new Map();
    const uniqueNames = Array.from(new Set(endpointNames.map(name => firstString(name)).filter(Boolean)));
    if (!reportId || !uniqueNames.length) return result;

    for (const endpointName of uniqueNames) {
        const controls = [];
        const rows = await fetchAction1Collection(
            headers,
            `${action1ApiBase}/reportdata/${encodeURIComponent(action1OrgId)}/${encodeURIComponent(reportId)}/data/${encodeURIComponent(endpointName)}/drilldown?limit=500&from=0&live_only=no&details=no`,
            { limit: 500, pageLimit: 10, action1ApiBase }
        ).catch(() => []);
        for (const row of rows) {
            const control = normalizeConfigurationControlRow(row);
            if (control) controls.push(control);
        }
        result.set(normalizeEndpointName(endpointName), controls);
    }
    return result;
}

function applyConfigurationPolicyCompliance(provisioningSummary, endpointControls = []) {
    const automationResults = (provisioningSummary.automationResults || []).map(result => {
        const policyId = configurationPolicyFromAutomationName(result.automationName);
        if (!policyId) return result;
        const compliance = summarizeConfigurationPolicyControls(policyId, endpointControls);
        const policyName = firstString(compliance.controls?.[0]?.policyName, configurationPolicyNameFromAutomationName(result.automationName));
        const effectiveStatus = compliance.status === 'NonCompliant'
            ? 'Failed'
            : compliance.status === 'Unknown'
                ? 'In progress'
                : result.status;
        return {
            ...result,
            status: effectiveStatus,
            configurationPolicyId: policyId,
            configurationPolicyName: policyName,
            policyComplianceStatus: compliance.status,
            policyComplianceDetail: compliance.detail,
            policyControls: compliance.controls,
            nonCompliantControls: compliance.nonCompliantControls
        };
    });

    const policyResults = automationResults.filter(result => result.configurationPolicyId);
    if (!policyResults.length) return { ...provisioningSummary, automationResults };

    if (policyResults.some(result => result.policyComplianceStatus === 'NonCompliant')) {
        return {
            status: 'Failed',
            detail: 'One or more Configuration Management policy controls are not compliant.',
            automationResults
        };
    }
    if (policyResults.some(result => result.policyComplianceStatus !== 'Compliant')) {
        return {
            status: 'In progress',
            detail: 'Waiting for Configuration Management policy compliance report results.',
            automationResults
        };
    }
    if (provisioningSummary.status === 'Completed') {
        return {
            status: 'Completed',
            detail: `${provisioningSummary.detail} All Configuration Management policy controls are compliant.`,
            automationResults
        };
    }
    return { ...provisioningSummary, automationResults };
}

function previousProvisioningByEndpoint(previousEndpointRegistration) {
    const previous = new Map();
    for (const endpoint of previousEndpointRegistration?.endpoints || []) {
        const keys = [
            endpoint.action1EndpointId,
            endpoint.intuneDeviceId,
            normalizeEndpointName(endpoint.deviceName)
        ].map(key => String(key || '').trim().toLowerCase()).filter(Boolean);
        for (const key of keys) {
            if (!previous.has(key)) previous.set(key, endpoint);
        }
    }
    return previous;
}

function findPreviousProvisioning(endpoint, previousByEndpoint) {
    const keys = [
        endpoint.action1EndpointId,
        endpoint.intuneDeviceId,
        normalizeEndpointName(endpoint.deviceName)
    ].map(key => String(key || '').trim().toLowerCase()).filter(Boolean);
    for (const key of keys) {
        const previous = previousByEndpoint.get(key);
        if (previous) return previous;
    }
    return null;
}

function summarizeProvisioningResults(results, previousResults = []) {
    const latestResults = mergeStickyCompletedAutomationResults(
        latestProvisioningResults(results),
        previousResults
    );
    if (!latestResults.length) return { status: NO_AUTOMATION_RESULT_STATUS, detail: 'No Action1 provisioning automation result was found for this endpoint.', automationResults: [] };
    if (latestResults.some(result => result.status === 'Failed')) return { status: 'Failed', detail: 'One or more latest Action1 provisioning automation runs failed.', automationResults: latestResults };
    if (latestResults.some(result => result.status === 'In progress')) return { status: 'In progress', detail: 'One or more Action1 provisioning automations are still running.', automationResults: latestResults };
    if (latestResults.every(result => result.status === 'Completed')) return { status: 'Completed', detail: 'Latest Action1 provisioning automation runs completed successfully.', automationResults: latestResults };
    return { status: NO_AUTOMATION_RESULT_STATUS, detail: 'No conclusive Action1 provisioning automation result was found for this endpoint.', automationResults: latestResults };
}

async function fetchAction1ProvisioningByEndpoint(action1ApiKey, action1ApiSecret, action1OrgId, endpointTargets, selectedAction1GroupIds = [], action1ApiBase = DEFAULT_ACTION1_BASE_URL, action1ConsoleBase = DEFAULT_ACTION1_CONSOLE_URL, previousByEndpoint = new Map()) {
    const targets = (endpointTargets || [])
        .map(target => typeof target === 'string' ? { id: target, name: '' } : target)
        .map(target => ({
            id: String(target?.id || '').trim(),
            name: firstString(target?.name, target?.deviceName, target?.endpointName)
        }))
        .filter(target => target.id);
    const targetIds = new Set(targets.map(target => target.id));
    const provisioningByEndpoint = new Map();
    if (!targetIds.size) return provisioningByEndpoint;

    const headers = await getAction1Headers(action1ApiKey, action1ApiSecret, action1ApiBase);
    const configurationReportId = await getConfigurationManagerByEndpointReportId();
    if (configurationReportId) {
        try {
            await requeryConfigurationManagerReport(headers, action1OrgId, configurationReportId, action1ApiBase);
            await updateProgress('Configuration Management report refresh requested.');
        } catch (reportRefreshError) {
            await updateProgress(`Warning: Could not refresh Configuration Management report: ${reportRefreshError.response?.data?.error?.message || reportRefreshError.message}`);
        }
    }
    const configurationControlsByEndpoint = await fetchConfigurationPolicyControlsForEndpoints(
        headers,
        action1OrgId,
        configurationReportId,
        targets.map(target => target.name),
        action1ApiBase
    );
    const instances = await fetchAction1Collection(
        headers,
        `${action1ApiBase}/automations/instances/${encodeURIComponent(action1OrgId)}?sortby=${encodeURIComponent('-end_time')}&limit=${ACTION1_AUTOMATION_INSTANCE_SCAN_LIMIT}&from=0`,
        { limit: ACTION1_AUTOMATION_INSTANCE_SCAN_LIMIT, pageLimit: 1, action1ApiBase }
    );
    let provisioningInstances = [];
    try {
        const provisioningSchedules = await fetchProvisioningSchedules(headers, action1OrgId, selectedAction1GroupIds, action1ApiBase);
        provisioningInstances = provisioningSchedules.flatMap(provisioningSchedule => {
            const recentInstances = instancesForSchedule(instances, provisioningSchedule).slice(0, 12);
            if (!recentInstances.length) {
                return [{
                    instance: null,
                    schedule: provisioningSchedule.schedule,
                    frequencyMinutes: provisioningSchedule.frequencyMinutes,
                    scheduleGroupIds: provisioningSchedule.scheduleGroupIds
                }];
            }
            return recentInstances.map(instance => ({
                instance,
                schedule: provisioningSchedule.schedule,
                frequencyMinutes: provisioningSchedule.frequencyMinutes,
                scheduleGroupIds: provisioningSchedule.scheduleGroupIds
            }));
        });
    } catch (scheduleListError) {
        await updateProgress(`Warning: Could not list assigned Action1 provisioning automations: ${scheduleListError.response?.data?.error?.message || scheduleListError.message}`);
        provisioningInstances = await selectLatestProvisioningInstances(headers, instances, selectedAction1GroupIds);
    }

    for (const provisioningInstance of provisioningInstances) {
        const instance = provisioningInstance.instance;
        const instanceId = action1InstanceId(instance);
        const scheduleId = firstString(provisioningInstance.schedule?.id);
        const scheduleName = firstString(provisioningInstance.schedule?.name, provisioningInstance.schedule?.displayName, provisioningInstance.schedule?.display_name, scheduleId);
        const scheduleKey = firstString(instance ? action1InstanceScheduleKey(instance) : '', scheduleId, scheduleName);
        const automationUrl = action1AutomationHistoryUrl(action1ConsoleBase, action1OrgId, instanceId);
        const results = instanceId
            ? await fetchAction1Collection(
                headers,
                `${action1ApiBase}/automations/instances/${encodeURIComponent(action1OrgId)}/${encodeURIComponent(instanceId)}/endpoint-results?limit=${ACTION1_AUTOMATION_ENDPOINT_RESULT_LIMIT}&from=0`,
                { limit: ACTION1_AUTOMATION_ENDPOINT_RESULT_LIMIT, action1ApiBase }
            )
            : [];
        const endpointsWithResults = new Set();
        for (const result of results) {
            const endpointId = firstString(result?.id, result?.endpoint_id, result?.endpointId);
            if (!targetIds.has(endpointId)) continue;
            const status = normalizeAutomationStatus(result, instance);
            if (!status) continue;
            endpointsWithResults.add(endpointId);
            if (!provisioningByEndpoint.has(endpointId)) provisioningByEndpoint.set(endpointId, []);
            provisioningByEndpoint.get(endpointId).push({
                status,
                scheduleKey,
                automationInstanceId: instanceId,
                automationName: firstString(instance?.name, instance?.action_name, result?.action_name, result?.automation_name, scheduleName, 'Unnamed automation'),
                startedAt: firstString(instance?.start_time, instance?.started_at, result?.start_time, result?.started_at),
                completedAt: firstString(result?.time, result?.end_time, result?.completed_at, instance?.end_time, instance?.completed_at),
                actionName: firstString(result?.action_name, result?.actionName),
                percentCompleted: firstString(result?.percent_completed, result?.percentCompleted, instance?.percent_completed),
                statusDetail: firstString(result?.description, result?.details_text, result?.status_details, result?.statusDetail, result?.message, result?.error, result?.error_message, instance?.status_details),
                runFrequencyMinutes: provisioningInstance.frequencyMinutes,
                scheduleId,
                scheduleSettings: firstString(provisioningInstance.schedule?.settings),
                provisioningEndpointGroups: provisioningInstance.scheduleGroupIds,
                automationUrl
            });
        }
        for (const endpointId of targetIds) {
            if (endpointsWithResults.has(endpointId)) continue;
            if (!provisioningByEndpoint.has(endpointId)) provisioningByEndpoint.set(endpointId, []);
            provisioningByEndpoint.get(endpointId).push({
                status: NO_AUTOMATION_RESULT_STATUS,
                scheduleKey,
                automationInstanceId: instanceId,
                automationName: scheduleName || 'Unnamed automation',
                startedAt: firstString(instance?.start_time, instance?.started_at),
                completedAt: firstString(instance?.end_time, instance?.completed_at),
                actionName: 'No endpoint result',
                percentCompleted: '',
                statusDetail: instanceId
                    ? 'No endpoint result was returned for this assigned Action1 automation in the latest run.'
                    : 'This Action1 automation is assigned to the provisioning group but has not produced a recent run.',
                runFrequencyMinutes: provisioningInstance.frequencyMinutes,
                scheduleId,
                scheduleSettings: firstString(provisioningInstance.schedule?.settings),
                provisioningEndpointGroups: provisioningInstance.scheduleGroupIds,
                automationUrl
            });
        }
    }

    const summarized = new Map();
    for (const endpointId of targetIds) {
        if (!provisioningByEndpoint.has(endpointId)) provisioningByEndpoint.set(endpointId, []);
    }
    for (const [endpointId, results] of provisioningByEndpoint.entries()) {
        const target = targets.find(target => target.id === endpointId);
        const previous = previousByEndpoint.get(String(endpointId || '').trim().toLowerCase());
        const previousResults = Array.isArray(previous?.automationResults) ? previous.automationResults : [];
        const endpointControls = configurationControlsByEndpoint.get(normalizeEndpointName(target?.name)) || [];
        summarized.set(endpointId, applyConfigurationPolicyCompliance(summarizeProvisioningResults(results, previousResults), endpointControls));
    }
    return summarized;
}

function addGroupMemberKey(groupMembershipByDeviceKey, key, groupName) {
    const normalizedKey = String(key || '').trim().toLowerCase();
    if (!normalizedKey || !groupName) return;
    if (!groupMembershipByDeviceKey.has(normalizedKey)) groupMembershipByDeviceKey.set(normalizedKey, new Set());
    groupMembershipByDeviceKey.get(normalizedKey).add(groupName);
}

function groupMemberDeviceKey(member) {
    return firstString(
        member.deviceId,
        member.id,
        normalizeEndpointName(member.displayName)
    );
}

function intuneDeviceTargetKeys(device) {
    const deviceName = firstString(device.deviceName, device.managedDeviceName, device.name);
    return [
        device.id,
        device.azureADDeviceId,
        device.azureAdDeviceId,
        deviceName,
        normalizeEndpointName(deviceName)
    ]
        .map(key => String(key || '').trim().toLowerCase())
        .filter(Boolean);
}

function addEndpointGroupKey(endpointGroupsByKey, key, groupName) {
    const normalizedKey = String(key || '').trim().toLowerCase();
    if (!normalizedKey || !groupName) return;
    if (!endpointGroupsByKey.has(normalizedKey)) endpointGroupsByKey.set(normalizedKey, new Set());
    endpointGroupsByKey.get(normalizedKey).add(groupName);
}

function action1EndpointKeys(endpoint) {
    const endpointName = firstString(endpoint?.device_name, endpoint?.deviceName, endpoint?.name, endpoint?.hostname, endpoint?.endpoint_name);
    return [
        endpoint?.id,
        endpoint?.endpoint_id,
        endpoint?.endpointId,
        endpoint?.action1EndpointId,
        endpoint?.device_id,
        endpoint?.deviceId,
        endpointName,
        normalizeEndpointName(endpointName)
    ]
        .map(key => String(key || '').trim().toLowerCase())
        .filter(Boolean);
}

function getAction1EndpointGroupNames(endpoint, endpointGroupsByKey) {
    const names = new Set();
    for (const key of action1EndpointKeys(endpoint)) {
        const matches = endpointGroupsByKey.get(key);
        if (matches) matches.forEach(name => names.add(name));
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
}

async function action1EndpointStillInGroup(action1ApiKey, action1ApiSecret, action1OrgId, endpoint, groupId, groupName, action1ApiBase = DEFAULT_ACTION1_BASE_URL) {
    const membership = await fetchAction1EndpointGroupMembership(
        action1ApiKey,
        action1ApiSecret,
        action1OrgId,
        [groupId],
        { [groupId]: groupName },
        action1ApiBase
    );
    return getAction1EndpointGroupNames({
        id: endpoint.action1EndpointId,
        endpoint_id: endpoint.action1EndpointId,
        endpointId: endpoint.action1EndpointId,
        deviceName: endpoint.deviceName,
        name: endpoint.deviceName
    }, membership).some(name => String(name || '').trim().toLowerCase() === String(groupName || groupId).trim().toLowerCase());
}

async function fetchAction1EndpointGroupMembership(action1ApiKey, action1ApiSecret, action1OrgId, selectedAction1GroupIds = [], selectedAction1GroupMap = {}, action1ApiBase = DEFAULT_ACTION1_BASE_URL) {
    const endpointGroupsByKey = new Map();
    const groupIds = selectedAction1GroupIds.map(String).filter(Boolean);
    if (!groupIds.length) return endpointGroupsByKey;

    const headers = await getAction1Headers(action1ApiKey, action1ApiSecret, action1ApiBase);
    for (const groupId of groupIds) {
        const groupName = String(selectedAction1GroupMap?.[groupId] || groupId).trim();
        const encodedOrgId = encodeURIComponent(action1OrgId);
        const encodedGroupId = encodeURIComponent(groupId);
        const candidateUrls = [
            `${action1ApiBase}/endpoints/groups/${encodedOrgId}/${encodedGroupId}/contents?limit=500&from=0`
        ];

        for (const url of candidateUrls) {
            try {
                const members = await fetchAction1Collection(headers, url, { limit: 500, action1ApiBase });
                if (!members.length) continue;
                for (const member of members) {
                    for (const key of action1EndpointKeys(member)) {
                        addEndpointGroupKey(endpointGroupsByKey, key, groupName);
                    }
                }
                break;
            } catch {}
        }
    }
    return endpointGroupsByKey;
}

async function fetchDeviceGroupMembership(graphHeaders, selectedGroupIds = []) {
    const groupMembershipByDeviceKey = new Map();
    const selectedGroupSet = new Set(selectedGroupIds.map(String).filter(Boolean));
    const assignmentTargetDeviceKeys = new Set();
    let redactedDeviceMembers = 0;
    const groups = await fetchGraphCollection(
        graphHeaders,
        'https://graph.microsoft.com/v1.0/groups?$select=id,displayName,description,securityEnabled,mailEnabled,groupTypes,membershipRule&$top=999'
    );
    const deviceGroups = groups
        .filter(group => group.securityEnabled || (group.groupTypes || []).includes('DynamicMembership'))
        .sort((a, b) => String(a.displayName || '').localeCompare(String(b.displayName || '')));

    for (const group of deviceGroups) {
        const groupName = group.displayName || group.id;
        const isSelectedAssignmentGroup = selectedGroupSet.has(String(group.id));
        const members = await fetchGraphCollection(
            graphHeaders,
            `https://graph.microsoft.com/v1.0/groups/${encodeURIComponent(group.id)}/members/microsoft.graph.device?$select=id,displayName,deviceId`
        );
        for (const member of members) {
            if (member.id && !member.deviceId && !member.displayName) {
                redactedDeviceMembers += 1;
            }
            addGroupMemberKey(groupMembershipByDeviceKey, member.id, groupName);
            addGroupMemberKey(groupMembershipByDeviceKey, member.deviceId, groupName);
            addGroupMemberKey(groupMembershipByDeviceKey, normalizeEndpointName(member.displayName), groupName);
            if (isSelectedAssignmentGroup) {
                const memberKey = groupMemberDeviceKey(member);
                if (memberKey) assignmentTargetDeviceKeys.add(String(memberKey).trim().toLowerCase());
            }
        }
    }
    return {
        groupMembershipByDeviceKey,
        redactedDeviceMembers,
        assignmentTargetDeviceCount: assignmentTargetDeviceKeys.size,
        assignmentTargetDeviceKeys
    };
}

function getDeviceGroupNames(device, groupMembershipByDeviceKey) {
    const deviceName = firstString(device.deviceName, device.managedDeviceName, device.name);
    const keys = [
        device.id,
        device.azureADDeviceId,
        device.azureAdDeviceId,
        deviceName,
        normalizeEndpointName(deviceName)
    ];
    const names = new Set();
    for (const key of keys) {
        const groupNames = groupMembershipByDeviceKey.get(String(key || '').trim().toLowerCase());
        if (groupNames) {
            for (const groupName of groupNames) names.add(groupName);
        }
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
}

async function compareIntuneDevicesToAction1(graphHeaders, { assignmentMode = ASSIGNMENT_MODE_ALL_DEVICES, selectedGroupIds = [], selectedGroupMap = {}, selectedAction1GroupIds = [], selectedAction1GroupMap = {}, selectedAction1OrgId = '', previousEndpointRegistration = null } = {}) {
    const action1Credentials = await getAction1Credentials();
    const { apiKey: action1ApiKey, apiSecret: action1ApiSecret } = action1Credentials;
    const action1OrgId = String(selectedAction1OrgId || action1Credentials.organizationId || '').trim();
    const action1ApiBase = action1BaseUrl(action1Credentials);
    const action1ConsoleBase = action1ConsoleUrl(action1Credentials);
    if (!action1ApiKey || !action1ApiSecret || !action1OrgId) {
        return {
            status: 'skipped',
            message: 'Action1 API credentials are not configured.',
            intuneTotal: 0,
            assignmentTargetDeviceCount: 0,
            action1Total: 0,
            registeredInAction1: 0,
            missingFromAction1: 0,
            missingFromIntune: 0,
            matchRate: 0,
            missingDevices: [],
            endpoints: []
        };
    }

    const [intuneDevices, action1Endpoints, groupMembership, action1EndpointGroupMembership] = await Promise.all([
        fetchGraphCollection(graphHeaders, `${INTUNE_GRAPH_BASE}/deviceManagement/managedDevices?$top=999`),
        fetchAction1ManagedEndpoints(action1ApiKey, action1ApiSecret, action1OrgId, action1ApiBase),
        fetchDeviceGroupMembership(graphHeaders, selectedGroupIds),
        fetchAction1EndpointGroupMembership(action1ApiKey, action1ApiSecret, action1OrgId, selectedAction1GroupIds, selectedAction1GroupMap, action1ApiBase)
    ]);
    const groupMembershipByDeviceKey = groupMembership.groupMembershipByDeviceKey;
    const groupMembershipStatus = groupMembership.redactedDeviceMembers > 0 ? 'limited_permissions' : 'checked';
    const groupMembershipMessage = groupMembership.redactedDeviceMembers > 0
        ? 'Microsoft Graph returned redacted device group members. Add Directory.Read.All or Device.Read.All application permission with admin consent to show endpoint device group names.'
        : '';
    const selectedGroupNameSet = new Set(
        selectedGroupIds
            .map(groupId => String(selectedGroupMap?.[groupId] || '').trim().toLowerCase())
            .filter(Boolean)
    );

    const action1ByName = new Map();
    for (const endpoint of action1Endpoints) {
        const name = normalizeEndpointName(firstString(endpoint.device_name, endpoint.name, endpoint.hostname, endpoint.endpoint_name));
        if (name && !action1ByName.has(name)) action1ByName.set(name, endpoint);
    }

    let registeredInAction1 = 0;
    const missingDevices = [];
    const endpoints = [];
    const intuneNames = new Set();
    for (const device of intuneDevices) {
        const deviceName = firstString(device.deviceName, device.managedDeviceName, device.name);
        const normalizedName = normalizeEndpointName(deviceName);
        if (normalizedName) intuneNames.add(normalizedName);
        const registered = normalizedName && action1ByName.has(normalizedName);
        const action1Endpoint = action1ByName.get(normalizedName);
        const deviceGroupNames = getDeviceGroupNames(device, groupMembershipByDeviceKey);
        const inAssignmentTarget = assignmentMode === ASSIGNMENT_MODE_ALL_DEVICES ||
            intuneDeviceTargetKeys(device).some(key => groupMembership.assignmentTargetDeviceKeys.has(key)) ||
            deviceGroupNames.some(groupName => selectedGroupNameSet.has(String(groupName || '').trim().toLowerCase()));
        const row = {
            id: device.id || normalizedName || deviceName || `intune-${endpoints.length}`,
            deviceName: deviceName || device.id || 'Unknown device',
            source: registered ? 'Synced' : 'Intune',
            inAssignmentTarget,
            intuneDeviceId: device.id || '',
            action1EndpointId: firstString(action1Endpoint?.id, action1Endpoint?.endpoint_id),
            action1EndpointGroups: action1Endpoint ? getAction1EndpointGroupNames(action1Endpoint, action1EndpointGroupMembership) : [],
            provisioningCompletedByAttribute: action1Endpoint ? hasCompletedProvisioningAttribute(action1Endpoint) : false,
            deviceGroups: deviceGroupNames,
            os: firstString(device.operatingSystem, device.osVersion),
            userPrincipalName: firstString(device.userPrincipalName, device.emailAddress),
            lastSyncDateTime: formatEndpointDate(device.lastSyncDateTime),
            azureADDeviceId: device.azureADDeviceId || device.azureAdDeviceId || ''
        };
        endpoints.push(row);
        if (registered) {
            registeredInAction1 += 1;
        } else {
            missingDevices.push(row);
        }
    }

    for (const [normalizedName, endpoint] of action1ByName.entries()) {
        if (intuneNames.has(normalizedName)) continue;
        const endpointName = firstString(endpoint.device_name, endpoint.name, endpoint.hostname, endpoint.endpoint_name);
        endpoints.push({
            id: firstString(endpoint.id, endpoint.endpoint_id, normalizedName) || `action1-${endpoints.length}`,
            deviceName: endpointName || normalizedName || 'Unknown device',
            source: 'Action1',
            inAssignmentTarget: false,
            intuneDeviceId: '',
            action1EndpointId: firstString(endpoint.id, endpoint.endpoint_id),
            action1EndpointGroups: getAction1EndpointGroupNames(endpoint, action1EndpointGroupMembership),
            provisioningCompletedByAttribute: hasCompletedProvisioningAttribute(endpoint),
            deviceGroups: [],
            os: firstString(endpoint.os, endpoint.operating_system, endpoint.os_name, endpoint.platform),
            userPrincipalName: firstString(endpoint.user, endpoint.username, endpoint.last_logged_on_user),
            lastSyncDateTime: formatEndpointDate(firstString(endpoint.last_seen, endpoint.last_seen_at, endpoint.last_checkin, endpoint.updated_at)),
            azureADDeviceId: ''
        });
    }

    const intuneTotal = intuneDevices.length;
    const assignmentTargetDeviceCount = assignmentMode === ASSIGNMENT_MODE_SELECTED_GROUPS
        ? groupMembership.assignmentTargetDeviceCount
        : intuneTotal;
    const assignmentTargetRegisteredInAction1 = endpoints.filter(endpoint => (
        endpoint.source === 'Synced' && endpoint.inAssignmentTarget
    )).length;
    const missingFromAction1 = missingDevices.length;
    const missingFromIntune = endpoints.filter(endpoint => endpoint.source === 'Action1').length;
    const matchRate = intuneTotal > 0 ? Math.round((registeredInAction1 / intuneTotal) * 100) : 0;
    let provisioningStatus = 'checked';
    let provisioningMessage = '';
    const previousProvisioning = previousProvisioningByEndpoint(previousEndpointRegistration);
    try {
        const selectedAction1GroupNames = new Set(selectedAction1GroupIds
            .flatMap(groupId => [groupId, selectedAction1GroupMap?.[groupId]])
            .map(value => String(value || '').trim().toLowerCase())
            .filter(Boolean));
        const isInSelectedAction1ProvisioningGroup = (endpoint) => (
            (endpoint.action1EndpointGroups || [])
                .some(groupName => selectedAction1GroupNames.has(String(groupName || '').trim().toLowerCase()))
        );
        const targetAction1Endpoints = endpoints
            .filter(endpoint => (
                endpoint.inAssignmentTarget &&
                endpoint.source === 'Synced' &&
                endpoint.action1EndpointId &&
                (isInSelectedAction1ProvisioningGroup(endpoint) || endpoint.provisioningCompletedByAttribute)
            ))
            .map(endpoint => ({ id: endpoint.action1EndpointId, name: endpoint.deviceName }));
        const provisioningByEndpoint = await fetchAction1ProvisioningByEndpoint(action1ApiKey, action1ApiSecret, action1OrgId, targetAction1Endpoints, selectedAction1GroupIds, action1ApiBase, action1ConsoleBase, previousProvisioning);
        for (const endpoint of endpoints) {
            const previous = findPreviousProvisioning(endpoint, previousProvisioning);
            if (endpoint.inAssignmentTarget && endpoint.source === 'Intune' && !endpoint.action1EndpointId) {
                endpoint.provisioningStatus = 'Awaiting Enrollment';
                endpoint.provisioningDetail = 'Device is assigned but has not enrolled into Action1 yet.';
                endpoint.automationResults = [];
                continue;
            }
            if (!endpoint.inAssignmentTarget || endpoint.source !== 'Synced' || !endpoint.action1EndpointId) {
                endpoint.provisioningStatus = 'N/A';
                endpoint.provisioningDetail = '';
                endpoint.automationResults = [];
                continue;
            }
            if (endpoint.provisioningCompletedByAttribute) {
                const provisioning = provisioningByEndpoint.get(endpoint.action1EndpointId);
                const latestAutomationResults = Array.isArray(provisioning?.automationResults) ? provisioning.automationResults : [];
                const previousAutomationResults = Array.isArray(previous?.automationResults) ? previous.automationResults : [];
                endpoint.automationResults = latestAutomationResults.length ? latestAutomationResults : previousAutomationResults;
                endpoint.provisioningManualOverride = Boolean(previous?.provisioningManualOverride);
                if (endpoint.provisioningManualOverride) {
                    endpoint.provisioningStatus = 'Completed';
                    endpoint.provisioningDetail = `${ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE} is ${ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE_VALUE} by manual override. Provisioning item statuses are retained below.`;
                } else if (provisioning?.status && provisioning.status !== 'Completed') {
                    endpoint.provisioningStatus = provisioning.status;
                    endpoint.provisioningDetail = `${provisioning.detail} ${ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE} is ${ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE_VALUE}, but this was not manually marked complete.`;
                } else {
                    endpoint.provisioningStatus = 'Completed';
                    endpoint.provisioningDetail = `${ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE} is ${ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE_VALUE}.`;
                }
                endpoint.provisioningCleanupStatus = previous?.provisioningCleanupStatus || '';
                endpoint.provisioningCleanupMessage = previous?.provisioningCleanupMessage || '';
                endpoint.provisioningCleanupGroupIds = previous?.provisioningCleanupGroupIds || [];
                endpoint.provisioningAttributeStatus = 'completed';
                endpoint.provisioningAttributeMessage = endpoint.provisioningManualOverride
                    ? `${ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE} is ${ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE_VALUE} by manual override.`
                    : `${ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE} is ${ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE_VALUE}.`;
                continue;
            }
            if (!isInSelectedAction1ProvisioningGroup(endpoint)) {
                endpoint.provisioningStatus = endpoint.provisioningCompletedByAttribute ? 'Completed' : 'N/A';
                endpoint.provisioningDetail = endpoint.provisioningCompletedByAttribute
                    ? `${ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE} is ${ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE_VALUE}.`
                    : 'Endpoint is not in a selected Action1 provisioning group.';
                endpoint.automationResults = [];
                endpoint.provisioningCleanupStatus = previous?.provisioningCleanupStatus || '';
                endpoint.provisioningCleanupMessage = previous?.provisioningCleanupMessage || '';
                endpoint.provisioningCleanupGroupIds = previous?.provisioningCleanupGroupIds || [];
                endpoint.provisioningAttributeStatus = endpoint.provisioningCompletedByAttribute ? 'completed' : '';
                endpoint.provisioningAttributeMessage = endpoint.provisioningCompletedByAttribute
                    ? `${ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE} is ${ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE_VALUE}.`
                    : '';
                continue;
            }
            const provisioning = provisioningByEndpoint.get(endpoint.action1EndpointId) || { status: NO_AUTOMATION_RESULT_STATUS, detail: 'No Action1 provisioning automation result was found for this endpoint.', automationResults: [] };
            endpoint.automationResults = provisioning.automationResults;
            endpoint.provisioningCleanupStatus = previous?.provisioningCleanupStatus || '';
            endpoint.provisioningCleanupMessage = previous?.provisioningCleanupMessage || '';
            endpoint.provisioningCleanupGroupIds = previous?.provisioningCleanupGroupIds || [];
            endpoint.provisioningAttributeStatus = endpoint.provisioningCompletedByAttribute ? 'completed' : '';
            endpoint.provisioningAttributeMessage = endpoint.provisioningCompletedByAttribute
                ? `${ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE} is ${ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE_VALUE}.`
                : '';

            if (provisioning.status === 'Completed' && endpoint.provisioningCompletedByAttribute) {
                endpoint.provisioningStatus = 'Completed';
                endpoint.provisioningDetail = `${provisioning.detail} ${ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE} is ${ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE_VALUE}.`;
            } else if (provisioning.status === 'Completed') {
                endpoint.provisioningStatus = 'In progress';
                endpoint.provisioningDetail = `${provisioning.detail} Waiting to set ${ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE}.`;
            } else {
                endpoint.provisioningStatus = provisioning.status;
                endpoint.provisioningDetail = provisioning.detail;
            }
        }

        const selectedAction1GroupSet = new Set(selectedAction1GroupIds.map(id => String(id || '').trim()).filter(Boolean));
        const automationCompletedEndpoints = endpoints.filter(endpoint => (
            endpoint.inAssignmentTarget &&
            endpoint.source === 'Synced' &&
            endpoint.action1EndpointId &&
            (provisioningByEndpoint.get(endpoint.action1EndpointId)?.status === 'Completed')
        ));
        if (automationCompletedEndpoints.length && selectedAction1GroupSet.size) {
            const headers = await getAction1Headers(action1ApiKey, action1ApiSecret, action1ApiBase);
            try {
                const attributeDefinition = await ensureAction1ProvisioningCustomAttribute(headers, action1ApiBase);
                if (attributeDefinition.changed) await updateProgress(attributeDefinition.message);
            } catch (attributeDefinitionError) {
                await updateProgress(`Warning: Could not verify Action1 provisioning custom attribute definition: ${attributeDefinitionError.response?.data?.error?.message || attributeDefinitionError.message}`);
            }
            for (const endpoint of automationCompletedEndpoints) {
                const previous = findPreviousProvisioning(endpoint, previousProvisioning);
                if (!endpoint.provisioningCompletedByAttribute) {
                    try {
                        await setAction1EndpointProvisioningAttribute(headers, action1OrgId, endpoint.action1EndpointId, action1ApiBase);
                        endpoint.provisioningCompletedByAttribute = true;
                        endpoint.provisioningStatus = 'Completed';
                        endpoint.provisioningDetail = `${endpoint.provisioningDetail || 'Provisioning automations completed successfully.'} ${ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE} set to ${ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE_VALUE}.`;
                        endpoint.provisioningAttributeStatus = 'completed';
                        endpoint.provisioningAttributeMessage = `${ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE} set to ${ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE_VALUE}.`;
                        await updateProgress(`Marked ${endpoint.deviceName} as provisioned with Action1 custom attribute.`);
                    } catch (attributeError) {
                        endpoint.provisioningStatus = 'In progress';
                        endpoint.provisioningDetail = `Provisioning automations completed, but ${ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE} could not be set.`;
                        endpoint.provisioningAttributeStatus = 'warning';
                        endpoint.provisioningAttributeMessage = attributeError.response?.data?.error?.message || attributeError.message;
                        await updateProgress(`Warning: Could not mark ${endpoint.deviceName} with Action1 provisioning custom attribute: ${endpoint.provisioningAttributeMessage}`);
                    }
                }

                if (endpoint.provisioningStatus !== 'Completed') continue;

                const endpointGroupIds = new Set((endpoint.action1EndpointGroups || [])
                    .map(groupName => Object.entries(selectedAction1GroupMap).find(([, name]) => name === groupName)?.[0] || groupName)
                    .map(id => String(id || '').trim())
                    .filter(Boolean));
                const previousCleanupGroupIds = new Set((previous?.provisioningCleanupGroupIds || [])
                    .map(id => String(id || '').trim())
                    .filter(Boolean));
                if (!previousCleanupGroupIds.size && previous?.provisioningCleanupStatus === 'completed') {
                    const previousCleanupMessage = String(previous?.provisioningCleanupMessage || '');
                    for (const groupId of selectedAction1GroupIds) {
                        const groupName = selectedAction1GroupMap?.[groupId] || groupId;
                        if (previousCleanupMessage.includes(groupName)) previousCleanupGroupIds.add(String(groupId).trim());
                    }
                }
                const groupsToRemove = selectedAction1GroupIds
                    .map(id => String(id || '').trim())
                    .filter(groupId => selectedAction1GroupSet.has(groupId) && endpointGroupIds.has(groupId));

                if (!groupsToRemove.length) continue;
                const cleanupMessages = [];
                const completedCleanupGroupIds = new Set(previousCleanupGroupIds);
                const successfulCleanupGroupIds = new Set();
                for (const groupId of groupsToRemove) {
                    const groupName = selectedAction1GroupMap?.[groupId] || groupId;
                    try {
                        const cleanup = await removeAction1EndpointFromGroup(headers, action1OrgId, groupId, endpoint.action1EndpointId, action1ApiBase);
                        const stillInGroup = await action1EndpointStillInGroup(action1ApiKey, action1ApiSecret, action1OrgId, endpoint, groupId, groupName, action1ApiBase);
                        if (stillInGroup) {
                            cleanupMessages.push(`${groupName}: removal requested but endpoint is still present in Action1`);
                        } else {
                            cleanupMessages.push(`${groupName}: ${firstString(cleanup?.user_message, cleanup?.message, 'removed')}`);
                            completedCleanupGroupIds.add(groupId);
                            successfulCleanupGroupIds.add(groupId);
                        }
                    } catch (cleanupError) {
                        cleanupMessages.push(`${groupName}: ${cleanupError.response?.data?.error?.message || cleanupError.message}`);
                    }
                }
                if (successfulCleanupGroupIds.size) {
                    const successfulCleanupGroupNames = new Set(Array.from(successfulCleanupGroupIds)
                        .map(groupId => selectedAction1GroupMap?.[groupId] || groupId)
                        .map(groupName => String(groupName || '').trim().toLowerCase())
                        .filter(Boolean));
                    endpoint.action1EndpointGroups = (endpoint.action1EndpointGroups || [])
                        .filter(groupName => !successfulCleanupGroupNames.has(String(groupName || '').trim().toLowerCase()));
                }
                endpoint.provisioningCleanupStatus = cleanupMessages.some(message => !/success|removed/i.test(message)) ? 'warning' : 'completed';
                endpoint.provisioningCleanupMessage = cleanupMessages.join('; ');
                endpoint.provisioningCleanupGroupIds = Array.from(completedCleanupGroupIds);
                await updateProgress(`Provisioned endpoint ${endpoint.deviceName} removed from provisioning group${groupsToRemove.length === 1 ? '' : 's'}: ${endpoint.provisioningCleanupMessage}`);
            }
        }
    } catch (provisioningError) {
        provisioningStatus = 'failed';
        provisioningMessage = `Unable to load Action1 automation results: ${provisioningError.message}`;
        for (const endpoint of endpoints) {
            if (endpoint.action1EndpointId && endpoint.provisioningCompletedByAttribute) {
                const previous = findPreviousProvisioning(endpoint, previousProvisioning);
                endpoint.provisioningStatus = 'Completed';
                endpoint.provisioningDetail = `${ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE} is ${ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE_VALUE}.`;
                endpoint.automationResults = Array.isArray(previous?.automationResults) ? previous.automationResults : [];
                endpoint.provisioningAttributeStatus = 'completed';
                endpoint.provisioningAttributeMessage = `${ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE} is ${ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE_VALUE}.`;
            } else if (endpoint.inAssignmentTarget && endpoint.source === 'Intune' && !endpoint.action1EndpointId) {
                endpoint.provisioningStatus = 'Awaiting Enrollment';
                endpoint.provisioningDetail = 'Device is assigned but has not enrolled into Action1 yet.';
                endpoint.automationResults = [];
            } else {
                endpoint.provisioningStatus = 'N/A';
                endpoint.provisioningDetail = provisioningMessage;
                endpoint.automationResults = [];
            }
        }
    }
    const registrationStatus = provisioningStatus === 'failed' ? 'failed' : 'checked';
    const registrationMessage = provisioningStatus === 'failed'
        ? provisioningMessage
        : `${registeredInAction1} of ${intuneTotal} Intune endpoints are registered in Action1.`;
    return {
        status: registrationStatus,
        message: registrationMessage,
        intuneTotal,
        assignmentTargetDeviceCount,
        assignmentTargetRegisteredInAction1,
        action1Total: action1Endpoints.length,
        registeredInAction1,
        missingFromAction1,
        missingFromIntune,
        matchRate,
        groupMembershipStatus,
        groupMembershipMessage,
        provisioningStatus,
        provisioningMessage,
        missingDevices: missingDevices.slice(0, 50),
        endpoints: endpoints.sort((a, b) => a.deviceName.localeCompare(b.deviceName)).slice(0, 5000)
    };
}

/** Create a new Win32 LOB app in Intune and upload the MSI content */
async function createIntuneApp(graphHeaders, msiBuffer, msiFileName, version, productCode, appName) {
    const graphBase = INTUNE_GRAPH_BASE;
    let appId = null;

    const largeIcon = await getAction1LargeIcon();
    const intuneContentFileName = `${safeFileName(appName) || 'Action1 Agent'}.intunewin`;

    // 1. Create the app shell
    const appBody = {
        "@odata.type": "#microsoft.graph.win32LobApp",
        displayName: appName,
        description: `${appName} Remote Monitoring and Management Agent`,
        publisher: "Action1 Corporation",
        informationUrl: ACTION1_APP_INFORMATION_URL,
        privacyInformationUrl: ACTION1_APP_PRIVACY_URL,
        ...(largeIcon ? { largeIcon } : {}),
        displayVersion: version,
        fileName: intuneContentFileName,
        installCommandLine: `msiexec /i "${msiFileName}" /qn`,
        uninstallCommandLine: `msiexec /x "${msiFileName}" /qn`,
        setupFilePath: msiFileName,
        installExperience: { runAsAccount: "system", deviceRestartBehavior: "suppress" },
        returnCodes: [
            { returnCode: 0, type: "success" },
            { returnCode: 1707, type: "success" },
            { returnCode: 3010, type: "softReboot" },
            { returnCode: 1641, type: "hardReboot" },
            { returnCode: 1618, type: "retry" },
            { returnCode: 1337, type: "retry" }
        ],
        detectionRules: productCode ? [{
            "@odata.type": "#microsoft.graph.win32LobAppProductCodeDetection",
            productCode: productCode,
            productVersionOperator: "notConfigured",
            productVersion: null
        }] : [{
            "@odata.type": "#microsoft.graph.win32LobAppFileSystemDetection",
            path: "C:\\Windows\\Action1",
            fileOrFolderName: "action1_agent.exe",
            check32BitOn64System: false,
            detectionType: "exists"
        }],
        minimumSupportedOperatingSystem: { v10_1903: true }
    };

    try {
    const appRes = await axios.post(`${graphBase}/deviceAppManagement/mobileApps`, appBody, { headers: graphHeaders });
    appId = appRes.data.id;

    // 2. Create content version
    const cvRes = await axios.post(
        `${graphBase}/deviceAppManagement/mobileApps/${appId}/microsoft.graph.win32LobApp/contentVersions`,
        {}, { headers: graphHeaders }
    );
    const cvId = cvRes.data.id;

    // 3. Package the MSI like IntuneWinAppUtil does: compress source content, then encrypt that package.
    const innerPackage = createIntuneWinInnerPackage(msiBuffer, msiFileName);
    const enc = encryptForIntune(innerPackage);

    // 4. Create content file entry
    const fileBody = {
        "@odata.type": "#microsoft.graph.mobileAppContentFile",
        name: intuneContentFileName,
        size: enc.sizeOriginal,
        sizeEncrypted: enc.sizeEncrypted,
        manifest: null,
        isDependency: false
    };
    const fileRes = await axios.post(
        `${graphBase}/deviceAppManagement/mobileApps/${appId}/microsoft.graph.win32LobApp/contentVersions/${cvId}/files`,
        fileBody, { headers: graphHeaders }
    );
    const fileId = fileRes.data.id;
    const fileUrl = `${graphBase}/deviceAppManagement/mobileApps/${appId}/microsoft.graph.win32LobApp/contentVersions/${cvId}/files/${fileId}`;

    // 5. Wait for Azure Storage URI
    const fileWithUri = await waitForFileState(
        graphHeaders,
        fileUrl,
        'upload URL',
        file => Boolean(file.azureStorageUri),
        450
    );

    // 6. Upload to Azure Storage
    await uploadToAzureStorage(fileWithUri.azureStorageUri, enc.uploadData);

    // 7. Commit the file
    await axios.post(`${fileUrl}/commit`, {
        fileEncryptionInfo: enc.encryptionInfo
    }, { headers: graphHeaders });

    // 8. Wait for commit success
    await waitForFileState(
        graphHeaders,
        fileUrl,
        'commit success',
        file => file.uploadState === 'commitFileSuccess',
        450
    );

    // 9. Update app to point to committed content
    await axios.patch(`${graphBase}/deviceAppManagement/mobileApps/${appId}`, {
        "@odata.type": "#microsoft.graph.win32LobApp",
        committedContentVersion: cvId
    }, { headers: graphHeaders });

    return appId;
    } catch (e) {
        if (appId) {
            try {
                await updateProgress("Creation did not complete. Removing partial Intune app before retry...");
                await deleteIntuneApp(graphHeaders, appId);
            } catch (cleanupError) {
                await updateProgress(`Warning: Could not remove partial Intune app: ${cleanupError.response?.data?.error?.message || cleanupError.message}`);
            }
        }
        throw e;
    }
}

async function clearIntuneAppRequirementRules(graphHeaders, app) {
    const requirementRules = Array.isArray(app?.requirementRules) ? app.requirementRules : [];
    if (!app?.id || requirementRules.length === 0) return false;
    await axios.patch(`${INTUNE_GRAPH_BASE}/deviceAppManagement/mobileApps/${app.id}`, {
        "@odata.type": "#microsoft.graph.win32LobApp",
        requirementRules: []
    }, { headers: graphHeaders });
    return true;
}

async function createMacIntuneApp(graphHeaders, pkgBuffer, fileName, appName, metadata) {
    let appId = null;
    try {
        const app = await axios.post(`${INTUNE_GRAPH_BASE}/deviceAppManagement/mobileApps`, {
            '@odata.type': '#microsoft.graph.macOSPkgApp',
            displayName: appName,
            description: `${appName} macOS agent`,
            publisher: 'Action1 Corporation',
            informationUrl: ACTION1_APP_INFORMATION_URL,
            privacyInformationUrl: ACTION1_APP_PRIVACY_URL,
            fileName,
            primaryBundleId: metadata.bundleId,
            primaryBundleVersion: metadata.version,
            includedApps: [{ bundleId: metadata.bundleId, bundleVersion: metadata.version }],
            ignoreVersionDetection: true,
            minimumSupportedOperatingSystem: { v12_0: true }
        }, { headers: graphHeaders });
        appId = app.data.id;
        const contentBase = `${INTUNE_GRAPH_BASE}/deviceAppManagement/mobileApps/${appId}/microsoft.graph.macOSPkgApp/contentVersions`;
        const version = await axios.post(contentBase, {}, { headers: graphHeaders });
        const encrypted = encryptForIntune(pkgBuffer);
        const file = await axios.post(`${contentBase}/${version.data.id}/files`, {
            '@odata.type': '#microsoft.graph.mobileAppContentFile',
            name: fileName,
            size: encrypted.sizeOriginal,
            sizeEncrypted: encrypted.sizeEncrypted,
            isDependency: false
        }, { headers: graphHeaders });
        const fileUrl = `${contentBase}/${version.data.id}/files/${file.data.id}`;
        const upload = await waitForFileState(graphHeaders, fileUrl, 'macOS PKG upload URL', entry => Boolean(entry.azureStorageUri), 450);
        await uploadToAzureStorage(upload.azureStorageUri, encrypted.uploadData);
        await axios.post(`${fileUrl}/commit`, { fileEncryptionInfo: encrypted.encryptionInfo }, { headers: graphHeaders });
        await waitForFileState(graphHeaders, fileUrl, 'macOS PKG commit', entry => entry.uploadState === 'commitFileSuccess', 450);
        await axios.patch(`${INTUNE_GRAPH_BASE}/deviceAppManagement/mobileApps/${appId}`, {
            '@odata.type': '#microsoft.graph.macOSPkgApp',
            committedContentVersion: version.data.id
        }, { headers: graphHeaders });
        return appId;
    } catch (error) {
        if (appId) await deleteIntuneApp(graphHeaders, appId).catch(() => {});
        throw error;
    }
}

async function ensureMacIntuneApp(graphHeaders, policy, credentials) {
    const appName = `${buildIntuneAppName(policy.organizationName)} (macOS)`;
    const { fileName, downloadUrl } = agentDownload('macos', policy.agentIds?.macos, policy.agentDownloadOrgName, action1ConsoleUrl(credentials));
    await updateProgress(`Downloading Action1 macOS PKG for ${policy.organizationName}...`);
    const response = await axios.get(downloadUrl, { responseType: 'arraybuffer', timeout: 120000, validateStatus: () => true });
    if (response.status < 200 || response.status >= 300) throw new Error(`Action1 macOS PKG download returned HTTP ${response.status}.`);
    const pkgBuffer = Buffer.from(response.data);
    const metadata = macPkgMetadata(pkgBuffer);
    const existing = await findManagedMacApp(graphHeaders, appName);
    const existingVersion = existing?.primaryBundleVersion || existing?.displayVersion || '';
    let appId = existing?.id || null;
    let action = 'none';
    if (!appId || !existingVersion || compareVersions(metadata.version, existingVersion) > 0) {
        await updateProgress(`Publishing ${appName} v${metadata.version} to Intune...`);
        const oldAppId = appId;
        appId = await createMacIntuneApp(graphHeaders, pkgBuffer, fileName, appName, metadata);
        action = oldAppId ? 'update' : 'create';
        await assignIntuneApp(graphHeaders, appId, normalizeAssignmentMode(policy.assignmentMode), policy.intuneDeviceGroupIds || [], 'macos');
        if (oldAppId) await deleteIntuneApp(graphHeaders, oldAppId);
    } else {
        await assignIntuneApp(graphHeaders, appId, normalizeAssignmentMode(policy.assignmentMode), policy.intuneDeviceGroupIds || [], 'macos');
    }
    await updateProgress(`${appName} v${metadata.version} assigned in Intune.`);
    return { platform: 'macos', intuneAppId: appId, latestVersion: metadata.version, lastAction: action, assignmentStatus: 'configured' };
}

async function reconcileLinuxPolicySettings(graphClient, policyBase, policyId, desiredSettings, graphHeaders) {
    const settingsBase = `${policyBase}/${policyId}/settings`;
    const existingSettings = [];
    let nextUrl = settingsBase;
    while (nextUrl) {
        const page = await graphClient.get(nextUrl, { headers: graphHeaders });
        existingSettings.push(...(page.data.value || []));
        nextUrl = page.data['@odata.nextLink'] || '';
    }
    for (const desired of desiredSettings) {
        const definitionId = desired.settingInstance.settingDefinitionId;
        const current = existingSettings.find(item => item.settingInstance?.settingDefinitionId === definitionId);
        if (!current) {
            await graphClient.post(settingsBase, desired, { headers: graphHeaders });
            continue;
        }
        const desiredValue = desired.settingInstance.choiceSettingValue?.value ?? desired.settingInstance.simpleSettingValue?.value;
        const currentValue = current.settingInstance.choiceSettingValue?.value ?? current.settingInstance.simpleSettingValue?.value;
        if (currentValue !== desiredValue) {
            await graphClient.patch(`${settingsBase}/${encodeURIComponent(current.id)}`, {
                settingInstance: desired.settingInstance
            }, { headers: graphHeaders });
        }
    }
}

async function ensureLinuxIntunePolicy(graphHeaders, policy, credentials) {
    const baseUrl = action1ConsoleUrl(credentials);
    const organizationName = policy.agentDownloadOrgName;
    const deb = agentDownload('deb', policy.agentIds?.deb, organizationName, baseUrl);
    const rpm = agentDownload('rpm', policy.agentIds?.rpm, organizationName, baseUrl);
    for (const [format, download] of [['DEB', deb], ['RPM', rpm]]) {
        await updateProgress(`Checking Action1 Linux ${format} package for ${policy.organizationName}...`);
        const response = await axios.get(download.downloadUrl, { responseType: 'arraybuffer', timeout: 120000, validateStatus: () => true });
        const buffer = Buffer.from(response.data);
        const valid = format === 'DEB' ? buffer.subarray(0, 8).toString('ascii') === '!<arch>\n' : buffer.subarray(0, 4).toString('hex') === 'edabeedb';
        if (response.status < 200 || response.status >= 300 || !valid) throw new Error(`Action1 Linux ${format} download is unavailable or is not a ${format} package (HTTP ${response.status}).`);
    }
    const name = `${buildIntuneAppName(policy.organizationName)} (Linux)`;
    const script = linuxInstallScript(deb.downloadUrl, rpm.downloadUrl);
    const body = linuxPolicyBody(name, script);
    const policyBase = `${INTUNE_GRAPH_BASE}/deviceManagement/configurationPolicies`;
    let nextUrl = `${policyBase}?$select=id,name,platforms`;
    let existing = null;
    while (nextUrl && !existing) {
        const page = await axios.get(nextUrl, { headers: graphHeaders });
        existing = (page.data.value || []).find(item => item.name === name && item.platforms === 'linux') || null;
        nextUrl = page.data['@odata.nextLink'] || '';
    }
    let policyId = existing?.id;
    if (policyId) {
        await axios.patch(`${policyBase}/${policyId}`, { description: body.description }, { headers: graphHeaders });
        await reconcileLinuxPolicySettings(axios, policyBase, policyId, body.settings, graphHeaders);
    } else {
        const created = await axios.post(policyBase, body, { headers: graphHeaders });
        policyId = created.data.id;
    }
    const mode = normalizeAssignmentMode(policy.assignmentMode);
    const assignments = mode === ASSIGNMENT_MODE_SELECTED_GROUPS
        ? (policy.intuneDeviceGroupIds || []).map(groupId => ({ target: { '@odata.type': '#microsoft.graph.groupAssignmentTarget', groupId } }))
        : [{ target: { '@odata.type': '#microsoft.graph.allDevicesAssignmentTarget' } }];
    await axios.post(`${policyBase}/${policyId}/assign`, { assignments }, { headers: graphHeaders });
    await updateProgress(`${name} script policy assigned in Intune. Linux endpoints download the DEB or RPM that matches their package manager.`);
    return { platform: 'linux', intunePolicyId: policyId, lastAction: existing ? 'update' : 'create', assignmentStatus: 'configured' };
}

async function ensureAdditionalPlatforms(graphHeaders, policy, credentials) {
    const results = {};
    for (const platform of (policy.platforms || ['windows']).filter(item => item !== 'windows')) {
        try {
            results[platform] = platform === 'macos'
                ? await ensureMacIntuneApp(graphHeaders, policy, credentials)
                : await ensureLinuxIntunePolicy(graphHeaders, policy, credentials);
        } catch (error) {
            const message = error.response?.data?.error?.message || error.message;
            results[platform] = { platform, assignmentStatus: 'failed', message };
            await updateProgress(`${platform} deployment failed: ${message}`);
        }
    }
    return results;
}

async function ensureIntuneAppForPolicy(graphHeaders, policy, baseAction1Credentials = {}) {
    const agentId = policy?.agentId || '';
    const organizationName = policy?.organizationName || '';
    const agentDownloadOrgName = policy?.agentDownloadOrgName || policy?.organizationName || '';
    const organizationId = policy?.organizationId || '';
    const desiredAppName = buildIntuneAppName(organizationName);
    const assignmentMode = normalizeAssignmentMode(policy?.assignmentMode);
    const selectedGroupIds = policy?.intuneDeviceGroupIds || [];
    const action1Credentials = { ...baseAction1Credentials };
    if (organizationId) action1Credentials.organizationId = organizationId;

    if (!organizationName || ((policy.platforms || ['windows']).includes('windows') && !agentId)) throw new Error(`Policy ${policy?.name || policy?.policyId || ''} is missing the Action1 Windows installer ID or organization name.`);
    if (assignmentMode === ASSIGNMENT_MODE_SELECTED_GROUPS && selectedGroupIds.length === 0) throw new Error(`Policy ${policy?.name || policy?.policyId || ''} must select at least one Intune device group, or choose All devices.`);

    if (!(policy.platforms || ['windows']).includes('windows')) {
        return { platforms: await ensureAdditionalPlatforms(graphHeaders, policy, action1Credentials) };
    }

    await updateProgress(`Downloading latest Action1 Agent MSI for ${organizationName}...`);
    const { msiFileName, downloadUrl } = buildAction1AgentDownloadUrl(agentId, agentDownloadOrgName, action1ConsoleUrl(action1Credentials));
    const msiRes = await axios.get(downloadUrl, { responseType: 'arraybuffer', timeout: 120000, validateStatus: () => true });
    const msiBuffer = Buffer.from(msiRes.data);
    assertMsiDownload(msiRes, msiBuffer);
    const latestVersion = extractMsiVersion(msiBuffer) || 'Unknown';
    const productCode = extractMsiProductCode(msiBuffer);
    if (latestVersion === 'Unknown') throw new Error(`Could not determine version from downloaded Action1 Agent MSI for ${organizationName}.`);

    await updateProgress(`Checking Intune for existing "${desiredAppName}" app...`);
    let intuneVersion = 'Not Found';
    let intuneAppId = null;
    let intuneAppName = null;
    let action = 'none';

    const { primary: action1App, duplicateApps } = await findManagedIntuneApp(graphHeaders, desiredAppName);
    await deleteDuplicateIntuneApps(graphHeaders, desiredAppName, duplicateApps);

    if (action1App) {
        intuneVersion = action1App.displayVersion || 'Unknown';
        intuneAppId = action1App.id;
        intuneAppName = action1App.displayName;
        await updateProgress(`Found: "${intuneAppName}" v${intuneVersion}`);
        try {
            const clearedRequirements = await clearIntuneAppRequirementRules(graphHeaders, action1App);
            if (clearedRequirements) await updateProgress(`Removed custom Intune app requirement rules for "${intuneAppName}".`);
        } catch (requirementError) {
            await updateProgress(`Warning: Could not remove custom Intune app requirement rules for "${intuneAppName}": ${requirementError.response?.data?.error?.message || requirementError.message}`);
        }
    } else {
        await updateProgress(`No "${desiredAppName}" app found in Intune.`);
    }

    if (!intuneAppId) {
        action = 'create';
        await updateProgress(`Creating new "${desiredAppName}" app v${latestVersion} in Intune...`);
        intuneAppId = await createIntuneApp(graphHeaders, msiBuffer, msiFileName, latestVersion, productCode, desiredAppName);
        intuneVersion = latestVersion;
        intuneAppName = desiredAppName;
        await updateProgress(`Successfully created "${desiredAppName}" v${latestVersion} in Intune.`);
    } else if (intuneVersion !== 'Unknown' && compareVersions(latestVersion, intuneVersion) > 0) {
        action = 'update';
        await updateProgress(`Updating "${desiredAppName}": v${intuneVersion} to v${latestVersion}...`);
        await axios.delete(`${INTUNE_GRAPH_BASE}/deviceAppManagement/mobileApps/${intuneAppId}`, { headers: graphHeaders });
        await updateProgress(`Removed old Intune app. Creating updated "${desiredAppName}" version...`);
        await new Promise(r => setTimeout(r, 3000));
        intuneAppId = await createIntuneApp(graphHeaders, msiBuffer, msiFileName, latestVersion, productCode, desiredAppName);
        intuneVersion = latestVersion;
        intuneAppName = desiredAppName;
        await updateProgress(`Successfully updated "${desiredAppName}" to v${latestVersion} in Intune.`);
    } else {
        action = 'none';
        await updateProgress(`"${desiredAppName}" is up to date (v${intuneVersion}). No action needed.`);
    }

    let assignmentStatus = 'not_checked';
    let assignmentMessage = 'Assignments were not checked.';
    if (intuneAppId) {
        const assignmentTarget = describeDesiredAssignments(assignmentMode, selectedGroupIds);
        await updateProgress(`Configuring "${desiredAppName}" assignment target: ${assignmentTarget}...`);
        await assignIntuneApp(graphHeaders, intuneAppId, assignmentMode, selectedGroupIds);
        assignmentStatus = 'configured';
        assignmentMessage = `Assigned to ${assignmentTarget}.`;
        await updateProgress(`Assignments configured for "${desiredAppName}": ${assignmentTarget}.`);
    }

    const platforms = await ensureAdditionalPlatforms(graphHeaders, policy, action1Credentials);
    return {
        latestVersion,
        intuneVersion,
        intuneAppId,
        intuneAppName: intuneAppName || desiredAppName,
        versionStatus: action === 'none' || action === 'create' || action === 'update' ? 'up_to_date' : 'unknown',
        lastAction: action,
        assignmentStatus,
        assignmentMessage,
        platforms
    };
}

function compareVersions(v1, v2) {
    const a = v1.split('.').map(Number);
    const b = v2.split('.').map(Number);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const x = a[i] || 0, y = b[i] || 0;
        if (x > y) return 1;
        if (x < y) return -1;
    }
    return 0;
}

async function getPreviousEndpointRegistration(policyId = '') {
    try {
        const previousData = JSON.parse(await getSetting('IntuneVersionData') || '{}');
        const previousRegistration = policyId
            ? previousData?.policyResults?.[policyId]?.endpointRegistration || (previousData?.selectedPolicyId === policyId ? previousData?.endpointRegistration : null)
            : previousData?.endpointRegistration;
        return previousRegistration && Array.isArray(previousRegistration.endpoints)
            ? previousRegistration
            : null;
    } catch {
        return null;
    }
}

async function runSync() {
    console.log('[Intune] Starting Intune Sync Engine...');
    try {
        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO sync_history (integration_id, status, details, assets_processed) VALUES ('intune', 'Running', 'Started sync', 0)`,
                function(err) { if (err) reject(err); else resolve(); }
            );
        });
        await new Promise(r => setTimeout(r, 300));

        const IntuneTenantId = await getSetting('IntuneTenantId');
        const IntuneClientId = await getSetting('IntuneClientId');
        const IntuneClientSecret = await getSetting('IntuneClientSecret');
        const enrollmentPolicies = await getEnrollmentPoliciesForSync();
        const activePolicy = enrollmentPolicies[0];
        const organizationPlans = buildOrganizationPlatformPlans(enrollmentPolicies);
        const deployedPlatforms = new Map();
        const activeOrganizationKey = activePolicy ? organizationKey(activePolicy) : '';
        const activeWindowsPlan = organizationPlans.get(activeOrganizationKey)?.get('windows');
        const IntuneAgentId = activePolicy?.agentId || '';
        const IntuneOrgName = activePolicy?.organizationName || '';
        const IntuneAgentDownloadOrgName = activePolicy?.agentDownloadOrgName || activePolicy?.organizationName || '';
        const IntuneAction1OrgId = activePolicy?.organizationId || '';
        const intuneDesiredAppName = buildIntuneAppName(IntuneOrgName);
        const assignmentMode = normalizeAssignmentMode(activePolicy?.assignmentMode);
        const selectedGroupIds = activePolicy?.intuneDeviceGroupIds || [];
        const deploymentAssignmentMode = normalizeAssignmentMode(activeWindowsPlan?.assignmentMode);
        const deploymentGroupIds = activeWindowsPlan?.intuneDeviceGroupIds || [];
        const selectedGroupMap = activePolicy?.intuneDeviceGroupMap || {};
        const selectedAction1GroupIds = activePolicy?.monitoredAction1GroupIds || [];
        const selectedAction1GroupMap = activePolicy?.monitoredAction1GroupMap || {};
        const action1Credentials = await getAction1Credentials();
        if (IntuneAction1OrgId) action1Credentials.organizationId = IntuneAction1OrgId;

        if (!IntuneTenantId || !IntuneClientId || !IntuneClientSecret) throw new Error("Intune credentials missing.");
        if (!activePolicy) throw new Error("Create at least one Enrollment and Provisioning profile before syncing.");
        if (!IntuneOrgName || ((activePolicy.platforms || ['windows']).includes('windows') && !IntuneAgentId)) throw new Error("The selected policy is missing the Action1 Windows installer ID or organization name.");
        if (assignmentMode === ASSIGNMENT_MODE_SELECTED_GROUPS && selectedGroupIds.length === 0) throw new Error("Select at least one Intune device group, or choose All devices.");

        // 1. Auth to Graph API
        await updateProgress("Authenticating to Microsoft Graph...");
        const tokenParams = new URLSearchParams();
        tokenParams.append('client_id', IntuneClientId);
        tokenParams.append('scope', 'https://graph.microsoft.com/.default');
        tokenParams.append('client_secret', IntuneClientSecret);
        tokenParams.append('grant_type', 'client_credentials');

        const authRes = await axios.post(`https://login.microsoftonline.com/${IntuneTenantId}/oauth2/v2.0/token`, tokenParams, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        const graphToken = authRes.data.access_token;
        const graphHeaders = { 'Authorization': `Bearer ${graphToken}`, 'Content-Type': 'application/json' };

        let latestVersion = 'Not selected';
        let intuneVersion = 'Not selected';
        let intuneAppId = null;
        let intuneAppName = null;
        let action = 'none';
        let assignmentStatus = 'not_selected';
        let assignmentMessage = 'Windows was not selected for this profile.';

        if ((activePolicy.platforms || ['windows']).includes('windows')) {
        // 2. Download latest Action1 Agent MSI
        await updateProgress("Downloading latest Action1 Agent MSI...");
        const { msiFileName, downloadUrl } = buildAction1AgentDownloadUrl(IntuneAgentId, IntuneAgentDownloadOrgName, action1ConsoleUrl(action1Credentials));

        const msiRes = await axios.get(downloadUrl, { responseType: 'arraybuffer', timeout: 120000, validateStatus: () => true });
        const msiBuffer = Buffer.from(msiRes.data);
        assertMsiDownload(msiRes, msiBuffer);
        latestVersion = extractMsiVersion(msiBuffer) || 'Unknown';
        const productCode = extractMsiProductCode(msiBuffer);

        if (latestVersion === 'Unknown') {
            throw new Error("Could not determine version from downloaded Action1 Agent MSI.");
        }
        await updateProgress(`Latest Action1 Agent version: ${latestVersion}`);

        // 3. Check for existing Intune Win32 LOB app
        await updateProgress(`Checking Intune for existing "${intuneDesiredAppName}" app...`);
        intuneVersion = 'Not Found';

        try {
            const { primary: action1App, duplicateApps } = await findManagedIntuneApp(graphHeaders, intuneDesiredAppName);
            await deleteDuplicateIntuneApps(graphHeaders, intuneDesiredAppName, duplicateApps);

            if (action1App) {
                intuneVersion = action1App.displayVersion || 'Unknown';
                intuneAppId = action1App.id;
                intuneAppName = action1App.displayName;
                await updateProgress(`Found: "${intuneAppName}" v${intuneVersion}`);
                try {
                    const clearedRequirements = await clearIntuneAppRequirementRules(graphHeaders, action1App);
                    if (clearedRequirements) await updateProgress("Removed custom Intune app requirement rules.");
                } catch (requirementError) {
                    await updateProgress(`Warning: Could not remove custom Intune app requirement rules: ${requirementError.response?.data?.error?.message || requirementError.message}`);
                }
            } else {
                await updateProgress(`No "${intuneDesiredAppName}" app found in Intune.`);
            }
        } catch (e) {
            await updateProgress(`Warning: Could not query Intune apps: ${e.response?.data?.error?.message || e.message}`);
        }

        // 4. Decide action
        if (!intuneAppId) {
            // App doesn't exist — create it
            action = 'create';
            await updateProgress(`Creating new "${intuneDesiredAppName}" app v${latestVersion} in Intune...`);

            try {
                intuneAppId = await createIntuneApp(graphHeaders, msiBuffer, msiFileName, latestVersion, productCode, intuneDesiredAppName);
                intuneVersion = latestVersion;
                intuneAppName = intuneDesiredAppName;
                await updateProgress(`Successfully created "${intuneDesiredAppName}" v${latestVersion} in Intune.`);
            } catch (e) {
                await updateProgress(`Failed to create Intune app: ${e.response?.data?.error?.message || e.message}`);
                action = 'create_failed';
            }

        } else if (intuneVersion !== 'Unknown' && compareVersions(latestVersion, intuneVersion) > 0) {
            // App exists but is outdated — remove old and create new
            action = 'update';
            await updateProgress(`Updating: v${intuneVersion} → v${latestVersion}...`);

            try {
                // Remove old app
                await axios.delete(`${INTUNE_GRAPH_BASE}/deviceAppManagement/mobileApps/${intuneAppId}`, { headers: graphHeaders });
                await updateProgress(`Removed old Intune app. Creating updated "${intuneDesiredAppName}" version...`);
                await new Promise(r => setTimeout(r, 3000)); // Give Graph API a moment

                // Create new app
                intuneAppId = await createIntuneApp(graphHeaders, msiBuffer, msiFileName, latestVersion, productCode, intuneDesiredAppName);
                intuneVersion = latestVersion;
                intuneAppName = intuneDesiredAppName;
                await updateProgress(`Successfully updated to v${latestVersion} in Intune.`);
            } catch (e) {
                await updateProgress(`Failed to update Intune app: ${e.response?.data?.error?.message || e.message}`);
                action = 'update_failed';
            }

        } else {
            // App is up to date
            action = 'none';
            await updateProgress(`Agent is up to date (v${intuneVersion}). No action needed.`);
        }

        assignmentStatus = 'not_checked';
        assignmentMessage = 'Assignments were not checked.';
        if (intuneAppId && !action.includes('failed')) {
            try {
                const assignmentTarget = describeDesiredAssignments(deploymentAssignmentMode, deploymentGroupIds);
                await updateProgress(`Configuring Intune assignment target: ${assignmentTarget}...`);
                await assignIntuneApp(graphHeaders, intuneAppId, deploymentAssignmentMode, deploymentGroupIds);
                assignmentStatus = 'configured';
                assignmentMessage = `Assigned to ${assignmentTarget}.`;
                await updateProgress(`Assignments configured: ${assignmentTarget}.`);
            } catch (assignmentError) {
                assignmentStatus = 'failed';
                assignmentMessage = assignmentError.response?.data?.error?.message || assignmentError.message;
                action = action === 'none' ? 'assignment_failed' : action;
                await updateProgress(`Failed to configure assignments: ${assignmentMessage}`);
            }
        }

        }

        if ((activePolicy.platforms || ['windows']).includes('windows')) {
            deployedPlatforms.set(`${activeOrganizationKey}:windows`, {
                latestVersion, intuneVersion, intuneAppId, intuneAppName,
                versionStatus: action === 'none' || action === 'create' || action === 'update' ? 'up_to_date' : 'unknown',
                lastAction: action, assignmentStatus, assignmentMessage
            });
        }
        const additionalPlatforms = {};
        for (const platform of (activePolicy.platforms || ['windows']).filter(item => item !== 'windows')) {
            const plan = organizationPlans.get(activeOrganizationKey).get(platform);
            const result = await ensureAdditionalPlatforms(graphHeaders, plan, action1Credentials);
            additionalPlatforms[platform] = result[platform];
            deployedPlatforms.set(`${activeOrganizationKey}:${platform}`, result[platform]);
        }
        const previousEndpointRegistration = await getPreviousEndpointRegistration(activePolicy.policyId);
        let endpointRegistration = {
            status: 'not_checked',
            message: 'Endpoint registration was not checked.',
            intuneTotal: 0,
            assignmentTargetDeviceCount: 0,
            assignmentTargetRegisteredInAction1: 0,
            action1Total: 0,
            registeredInAction1: 0,
            missingFromAction1: 0,
            missingFromIntune: 0,
            matchRate: 0,
            missingDevices: [],
            endpoints: []
        };
        try {
            await updateProgress('Comparing Intune managed devices to Action1 endpoints...');
            endpointRegistration = await compareIntuneDevicesToAction1(graphHeaders, {
                assignmentMode,
                selectedGroupIds,
                selectedGroupMap,
                selectedAction1GroupIds,
                selectedAction1GroupMap,
                selectedAction1OrgId: IntuneAction1OrgId,
                previousEndpointRegistration
            });
            if (endpointRegistration.status === 'failed' && previousEndpointRegistration?.endpoints?.length) {
                endpointRegistration = {
                    ...previousEndpointRegistration,
                    status: 'failed',
                    message: endpointRegistration.message,
                    provisioningStatus: endpointRegistration.provisioningStatus || 'failed',
                    provisioningMessage: endpointRegistration.provisioningMessage || endpointRegistration.message,
                    usingStaleEndpointData: true,
                    staleEndpointDataReason: endpointRegistration.message
                };
            }
            await updateProgress(endpointRegistration.message);
        } catch (registrationError) {
            const failureMessage = registrationError.response?.data?.error?.message || registrationError.message;
            endpointRegistration = {
                ...(previousEndpointRegistration?.endpoints?.length ? previousEndpointRegistration : endpointRegistration),
                status: 'failed',
                message: failureMessage,
                provisioningStatus: 'failed',
                provisioningMessage: failureMessage,
                usingStaleEndpointData: Boolean(previousEndpointRegistration?.endpoints?.length),
                staleEndpointDataReason: failureMessage
            };
            await updateProgress(`Endpoint registration comparison failed: ${endpointRegistration.message}`);
        }

        const policyResults = {
            [activePolicy.policyId]: {
                policyId: activePolicy.policyId,
                policyName: activePolicy.name,
                organizationId: IntuneAction1OrgId,
                organizationName: IntuneOrgName,
                intuneDeployment: {
                    latestVersion,
                    intuneVersion,
                    intuneAppId,
                    intuneAppName,
                    versionStatus: action === 'none' || action === 'create' || action === 'update' ? 'up_to_date' : 'unknown',
                    assignmentStatus,
                    assignmentMessage,
                    platforms: additionalPlatforms
                },
                endpointRegistration
            }
        };
        for (const policy of enrollmentPolicies.slice(1)) {
            try {
                const policyDeployment = { platforms: {} };
                const key = organizationKey(policy);
                for (const platform of policy.platforms || ['windows']) {
                    const deploymentKey = `${key}:${platform}`;
                    if (!deployedPlatforms.has(deploymentKey)) {
                        const plan = organizationPlans.get(key).get(platform);
                        const result = await ensureIntuneAppForPolicy(graphHeaders, plan, action1Credentials);
                        deployedPlatforms.set(deploymentKey, platform === 'windows' ? result : result.platforms[platform]);
                    }
                    if (platform === 'windows') {
                        const { platforms: _platforms, ...windowsDeployment } = deployedPlatforms.get(deploymentKey);
                        Object.assign(policyDeployment, windowsDeployment);
                    }
                    else policyDeployment.platforms[platform] = deployedPlatforms.get(deploymentKey);
                }
                await updateProgress(`Refreshing dashboard results for policy ${policy.name}...`);
                const policyEndpointRegistration = await compareIntuneDevicesToAction1(graphHeaders, {
                    assignmentMode: normalizeAssignmentMode(policy.assignmentMode),
                    selectedGroupIds: policy.intuneDeviceGroupIds || [],
                    selectedGroupMap: policy.intuneDeviceGroupMap || {},
                    selectedAction1GroupIds: policy.monitoredAction1GroupIds || [],
                    selectedAction1GroupMap: policy.monitoredAction1GroupMap || {},
                    selectedAction1OrgId: policy.organizationId,
                    previousEndpointRegistration: await getPreviousEndpointRegistration(policy.policyId)
                });
                policyResults[policy.policyId] = {
                    policyId: policy.policyId,
                    policyName: policy.name,
                    organizationId: policy.organizationId,
                    organizationName: policy.organizationName,
                    intuneDeployment: policyDeployment,
                    endpointRegistration: policyEndpointRegistration
                };
            } catch (policyError) {
                policyResults[policy.policyId] = {
                    policyId: policy.policyId,
                    policyName: policy.name,
                    organizationId: policy.organizationId,
                    organizationName: policy.organizationName,
                    endpointRegistration: {
                        status: 'failed',
                        message: policyError.response?.data?.error?.message || policyError.message,
                        endpoints: []
                    }
                };
                await updateProgress(`Policy ${policy.name} dashboard refresh failed: ${policyResults[policy.policyId].endpointRegistration.message}`);
            }
        }

        // 5. Store results
        const versionStatus = action === 'none' ? 'up_to_date'
            : (action === 'create' || action === 'update') ? 'up_to_date'
            : action === 'create_failed' ? 'not_deployed'
            : action === 'update_failed' ? 'update_available'
            : 'unknown';

        const resultData = JSON.stringify({
            latestVersion,
            intuneVersion,
            intuneAppId,
            intuneAppName: intuneAppName || intuneDesiredAppName,
            versionStatus,
            lastAction: action,
            assignmentMode,
            selectedGroupIds,
            selectedGroupMap,
            policies: enrollmentPolicies,
            selectedPolicyId: activePolicy.policyId,
            selectedPolicyName: activePolicy.name,
            selectedAction1OrgId: IntuneAction1OrgId,
            selectedAction1OrgName: IntuneOrgName,
            selectedAction1GroupIds,
            selectedAction1GroupMap,
            policyResults,
            assignmentStatus,
            assignmentMessage,
            platforms: additionalPlatforms,
            endpointRegistration,
            checkedAt: new Date().toISOString()
        });

        await new Promise(r => db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('IntuneVersionData', ?)`, [resultData], r));
        
        const failureReasons = [];
        if (action.includes('failed')) failureReasons.push(`Action failed: ${action}`);
        if (assignmentStatus === 'failed') failureReasons.push(`Assignment failed: ${assignmentMessage}`);
        for (const [platform, deployment] of Object.entries(additionalPlatforms)) {
            if (deployment.assignmentStatus === 'failed') failureReasons.push(`${platform} deployment failed: ${deployment.message}`);
        }
        for (const policy of enrollmentPolicies.slice(1)) {
            const result = policyResults[policy.policyId];
            if (result.endpointRegistration?.status === 'failed') failureReasons.push(`${policy.name} dashboard refresh failed: ${result.endpointRegistration.message}`);
            if (result.intuneDeployment?.assignmentStatus === 'failed') failureReasons.push(`${policy.name} Windows assignment failed: ${result.intuneDeployment.assignmentMessage}`);
            for (const [platform, deployment] of Object.entries(result.intuneDeployment?.platforms || {})) {
                if (deployment.assignmentStatus === 'failed') failureReasons.push(`${policy.name} ${platform} deployment failed: ${deployment.message}`);
            }
        }
        if (endpointRegistration.status === 'failed') failureReasons.push(`Endpoint registration comparison failed: ${endpointRegistration.message}`);
        if (endpointRegistration.provisioningStatus === 'failed' && endpointRegistration.provisioningMessage && endpointRegistration.provisioningMessage !== endpointRegistration.message) {
            failureReasons.push(`Provisioning status failed: ${endpointRegistration.provisioningMessage}`);
        }
        const finalStatus = failureReasons.length ? 'Failed' : 'Success';
        const finalMessage = failureReasons.length
            ? `Check failed. ${failureReasons.join(' | ')}`
            : `Check complete. Action: ${action} | Latest: v${latestVersion} | Intune: v${intuneVersion} | Assignments: ${assignmentStatus}`;
        await updateProgress(finalMessage, finalStatus);

        const runId = await new Promise(r => db.get("SELECT id FROM sync_history WHERE integration_id = 'intune' ORDER BY id DESC LIMIT 1", (err, row) => r(row?.id)));
        if (runId) db.run(`UPDATE sync_history SET assets_processed = 0 WHERE id = ?`, [runId]);

    } catch (e) {
        console.error("Intune Sync Error:", e);
        await updateProgress(`Error: ${e.message}`, 'Failed');
    }
}

async function sync(context) {
  axios = context.http;
  db = context.db.raw;
  getSetting = context.settings.get;
  getAction1Credentials = context.action1.getCredentials;
  computeAndSaveRunMetrics = context.services.computeAndSaveRunMetrics;
  nvdService = context.services.nvd;
  return runSync();
}

module.exports = {
  sync,
  buildDesiredAssignments,
  buildOrganizationPlatformPlans,
  reconcileLinuxPolicySettings
};
