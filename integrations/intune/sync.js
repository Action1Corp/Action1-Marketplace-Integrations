let axios;
let db;
let getSetting;
let getAction1Credentials;
let computeAndSaveRunMetrics;
let nvdService;



const crypto = require('crypto');
const zlib = require('zlib');

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

function buildRequiredAssignment(target) {
    return {
        "@odata.type": "#microsoft.graph.mobileAppAssignment",
        intent: "required",
        target,
        settings: buildAssignmentSettings()
    };
}

function buildDesiredAssignments(mode, selectedGroupIds) {
    if (mode === ASSIGNMENT_MODE_SELECTED_GROUPS) {
        if (selectedGroupIds.length === 0) {
            throw new Error('Select at least one Intune device group, or choose All devices.');
        }
        return selectedGroupIds.map(groupId => buildRequiredAssignment({
            "@odata.type": "#microsoft.graph.groupAssignmentTarget",
            groupId
        }));
    }

    return [buildRequiredAssignment({
        "@odata.type": "#microsoft.graph.allDevicesAssignmentTarget"
    })];
}

function describeDesiredAssignments(mode, selectedGroupIds) {
    return mode === ASSIGNMENT_MODE_SELECTED_GROUPS
        ? `${selectedGroupIds.length} selected device group${selectedGroupIds.length === 1 ? '' : 's'}`
        : 'All devices';
}

async function assignIntuneApp(graphHeaders, appId, mode, selectedGroupIds) {
    await axios.post(`${INTUNE_GRAPH_BASE}/deviceAppManagement/mobileApps/${appId}/assign`, {
        mobileAppAssignments: buildDesiredAssignments(mode, selectedGroupIds)
    }, { headers: graphHeaders });
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
    const raw = firstString(result?.completedAt, result?.startedAt);
    if (!raw) return 0;
    const normalized = raw.replace(/^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})$/, '$1T$2:$3:$4Z');
    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
}

function latestProvisioningResults(results) {
    const latestByAutomation = new Map();
    for (const result of results) {
        const automationKey = String(result.automationName || result.actionName || 'Unnamed automation').trim().toLowerCase();
        const current = latestByAutomation.get(automationKey);
        if (!current || automationResultTime(result) >= automationResultTime(current)) {
            latestByAutomation.set(automationKey, result);
        }
    }
    return Array.from(latestByAutomation.values()).sort((a, b) => automationResultTime(b) - automationResultTime(a));
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
    return parseAction1Time(firstString(instance?.end_time, instance?.endTime, instance?.start_time, instance?.startTime));
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

async function fetchAction1EndpointGroup(headers, action1OrgId, groupId, action1ApiBase = DEFAULT_ACTION1_BASE_URL) {
    const response = await requestAction1({
        method: 'get',
        url: `${action1ApiBase}/endpoints/groups/${encodeURIComponent(action1OrgId)}/${encodeURIComponent(groupId)}`,
        headers
    }, 'Action1 endpoint group request');
    return response.data || {};
}

function hasProvisionedAttributeExclusion(filters = []) {
    const desiredField = `custom:${ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE}`.toLowerCase();
    const desiredValue = ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE_VALUE.toLowerCase();
    return (Array.isArray(filters) ? filters : []).some(filter => (
        String(filter?.field_name || '').trim().toLowerCase() === desiredField &&
        String(filter?.field_value || '').trim().toLowerCase() === desiredValue &&
        String(filter?.mode || '').trim().toLowerCase() === 'include'
    ));
}

async function ensureAction1ProvisioningGroupExclusion(headers, action1OrgId, groupId, action1ApiBase = DEFAULT_ACTION1_BASE_URL) {
    const group = await fetchAction1EndpointGroup(headers, action1OrgId, groupId, action1ApiBase);
    const excludeFilter = Array.isArray(group.exclude_filter) ? group.exclude_filter : [];
    if (hasProvisionedAttributeExclusion(excludeFilter)) {
        return { changed: false, message: `${group.name || groupId} already excludes provisioned endpoints.` };
    }

    const desiredField = `custom:${ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE}`.toLowerCase();
    const desiredValue = ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE_VALUE.toLowerCase();
    const updatedExcludeFilter = [
        ...excludeFilter.filter(filter => !(
            String(filter?.field_name || '').trim().toLowerCase() === desiredField &&
            String(filter?.field_value || '').trim().toLowerCase() === desiredValue
        )),
        {
            field_name: `custom:${ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE}`,
            field_value: ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE_VALUE,
            mode: 'include'
        }
    ];
    await requestAction1({
        method: 'patch',
        url: `${action1ApiBase}/endpoints/groups/${encodeURIComponent(action1OrgId)}/${encodeURIComponent(groupId)}`,
        headers: { ...headers, 'Content-Type': 'application/json' },
        data: { exclude_filter: updatedExcludeFilter }
    }, 'Action1 endpoint group exclusion request');
    return { changed: true, message: `${group.name || groupId} now excludes provisioned endpoints.` };
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

    const matchingInstances = instances.filter(instance => (
        action1InstanceGroupIds(instance).some(groupId => selectedGroupSet.has(groupId))
    ));
    const scheduleCache = new Map();
    const latestBySchedule = new Map();

    for (const instance of matchingInstances) {
        const scheduleUrl = firstString(instance?.schedule);
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

        const scheduleGroups = action1GroupIds(schedule?.endpoints || schedule?.endpoint_groups || schedule?.endpointGroups || schedule?.targets);
        if (scheduleGroups.length && !scheduleGroups.some(groupId => selectedGroupSet.has(groupId))) continue;

        const frequencyMinutes = action1ScheduleFrequencyMinutes(schedule, instance);
        const current = latestBySchedule.get(scheduleKey);
        if (!current || action1InstanceTime(instance) >= action1InstanceTime(current.instance)) {
            latestBySchedule.set(scheduleKey, {
                instance,
                schedule,
                frequencyMinutes,
                scheduleGroupIds: scheduleGroups.length ? scheduleGroups : action1InstanceGroupIds(instance)
            });
        }
    }

    return Array.from(latestBySchedule.values()).sort((a, b) => action1InstanceTime(b.instance) - action1InstanceTime(a.instance));
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

function summarizeProvisioningResults(results) {
    const latestResults = latestProvisioningResults(results);
    if (!latestResults.length) return { status: NO_AUTOMATION_RESULT_STATUS, detail: 'No Action1 provisioning automation result was found for this endpoint.', automationResults: [] };
    if (latestResults.some(result => result.status === 'Failed')) return { status: 'Failed', detail: 'One or more latest Action1 provisioning automation runs failed.', automationResults: latestResults };
    if (latestResults.some(result => result.status === 'In progress')) return { status: 'In progress', detail: 'One or more Action1 provisioning automations are still running.', automationResults: latestResults };
    if (latestResults.every(result => result.status === 'Completed')) return { status: 'Completed', detail: 'Latest Action1 provisioning automation runs completed successfully.', automationResults: latestResults };
    return { status: NO_AUTOMATION_RESULT_STATUS, detail: 'No conclusive Action1 provisioning automation result was found for this endpoint.', automationResults: latestResults };
}

async function fetchAction1ProvisioningByEndpoint(action1ApiKey, action1ApiSecret, action1OrgId, endpointIds, selectedAction1GroupIds = [], action1ApiBase = DEFAULT_ACTION1_BASE_URL) {
    const targetIds = new Set(endpointIds.map(id => String(id || '').trim()).filter(Boolean));
    const provisioningByEndpoint = new Map();
    if (!targetIds.size) return provisioningByEndpoint;

    const headers = await getAction1Headers(action1ApiKey, action1ApiSecret, action1ApiBase);
    const instances = await fetchAction1Collection(
        headers,
        `${action1ApiBase}/automations/instances/${encodeURIComponent(action1OrgId)}?sortby=${encodeURIComponent('-end_time')}&limit=${ACTION1_AUTOMATION_INSTANCE_SCAN_LIMIT}&from=0`,
        { limit: ACTION1_AUTOMATION_INSTANCE_SCAN_LIMIT, pageLimit: 1, action1ApiBase }
    );
    const provisioningInstances = await selectLatestProvisioningInstances(headers, instances, selectedAction1GroupIds);

    for (const provisioningInstance of provisioningInstances) {
        const instance = provisioningInstance.instance;
        const instanceId = firstString(instance?.id, instance?.instance_id, instance?.instanceId);
        if (!instanceId) continue;
        const results = await fetchAction1Collection(
            headers,
            `${action1ApiBase}/automations/instances/${encodeURIComponent(action1OrgId)}/${encodeURIComponent(instanceId)}/endpoint-results?limit=${ACTION1_AUTOMATION_ENDPOINT_RESULT_LIMIT}&from=0`,
            { limit: ACTION1_AUTOMATION_ENDPOINT_RESULT_LIMIT, action1ApiBase }
        );
        for (const result of results) {
            const endpointId = firstString(result?.id, result?.endpoint_id, result?.endpointId);
            if (!targetIds.has(endpointId)) continue;
            const status = normalizeAutomationStatus(result, instance);
            if (!status) continue;
            if (!provisioningByEndpoint.has(endpointId)) provisioningByEndpoint.set(endpointId, []);
            provisioningByEndpoint.get(endpointId).push({
                status,
                automationName: firstString(instance?.name, instance?.action_name, result?.action_name, result?.automation_name, 'Unnamed automation'),
                startedAt: firstString(instance?.start_time, instance?.started_at, result?.start_time, result?.started_at),
                completedAt: firstString(result?.time, result?.end_time, result?.completed_at, instance?.end_time, instance?.completed_at),
                actionName: firstString(result?.action_name, result?.actionName),
                percentCompleted: firstString(result?.percent_completed, result?.percentCompleted, instance?.percent_completed),
                statusDetail: firstString(result?.description, result?.details_text, result?.status_details, result?.statusDetail, result?.message, result?.error, result?.error_message, instance?.status_details),
                runFrequencyMinutes: provisioningInstance.frequencyMinutes,
                scheduleId: firstString(provisioningInstance.schedule?.id),
                scheduleSettings: firstString(provisioningInstance.schedule?.settings),
                provisioningEndpointGroups: provisioningInstance.scheduleGroupIds
            });
        }
    }

    const summarized = new Map();
    for (const [endpointId, results] of provisioningByEndpoint.entries()) {
        summarized.set(endpointId, summarizeProvisioningResults(results));
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
    const endpointName = firstString(endpoint?.device_name, endpoint?.name, endpoint?.hostname, endpoint?.endpoint_name);
    return [
        endpoint?.id,
        endpoint?.endpoint_id,
        endpoint?.endpointId,
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
            `${action1ApiBase}/endpoints/groups/${encodedOrgId}/${encodedGroupId}/endpoints?limit=500&from=0`,
            `${action1ApiBase}/endpoints/groups/${encodedOrgId}/${encodedGroupId}/members?limit=500&from=0`,
            `${action1ApiBase}/endpoints/managed/${encodedOrgId}?group_id=${encodedGroupId}&limit=500&from=0`
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

async function compareIntuneDevicesToAction1(graphHeaders, { assignmentMode = ASSIGNMENT_MODE_ALL_DEVICES, selectedGroupIds = [], selectedGroupMap = {}, selectedAction1GroupIds = [], selectedAction1GroupMap = {}, previousEndpointRegistration = null } = {}) {
    const action1Credentials = await getAction1Credentials();
    const { apiKey: action1ApiKey, apiSecret: action1ApiSecret, organizationId: action1OrgId } = action1Credentials;
    const action1ApiBase = action1BaseUrl(action1Credentials);
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
        const targetAction1EndpointIds = endpoints
            .filter(endpoint => endpoint.inAssignmentTarget && endpoint.source === 'Synced' && endpoint.action1EndpointId)
            .map(endpoint => endpoint.action1EndpointId);
        const provisioningByEndpoint = await fetchAction1ProvisioningByEndpoint(action1ApiKey, action1ApiSecret, action1OrgId, targetAction1EndpointIds, selectedAction1GroupIds, action1ApiBase);
        for (const endpoint of endpoints) {
            const previous = findPreviousProvisioning(endpoint, previousProvisioning);
            if (endpoint.action1EndpointId && endpoint.provisioningCompletedByAttribute) {
                endpoint.provisioningStatus = 'Completed';
                endpoint.provisioningDetail = `${ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE} is ${ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE_VALUE}.`;
                endpoint.automationResults = previous?.automationResults || [];
                endpoint.provisioningCleanupStatus = previous?.provisioningCleanupStatus || '';
                endpoint.provisioningCleanupMessage = previous?.provisioningCleanupMessage || '';
                endpoint.provisioningCleanupGroupIds = previous?.provisioningCleanupGroupIds || [];
                endpoint.provisioningAttributeStatus = 'completed';
                endpoint.provisioningAttributeMessage = `${ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE} is ${ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE_VALUE}.`;
                continue;
            }
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
            const provisioning = provisioningByEndpoint.get(endpoint.action1EndpointId) || { status: NO_AUTOMATION_RESULT_STATUS, detail: 'No Action1 provisioning automation result was found for this endpoint.', automationResults: [] };
            if ((provisioning.status === 'N/A' || provisioning.status === NO_AUTOMATION_RESULT_STATUS) && previous?.provisioningStatus === 'Completed') {
                endpoint.provisioningStatus = 'Completed';
                endpoint.provisioningDetail = previous.provisioningDetail || 'Provisioning previously completed successfully.';
                endpoint.automationResults = previous.automationResults || [];
                endpoint.provisioningCleanupStatus = previous.provisioningCleanupStatus || '';
                endpoint.provisioningCleanupMessage = previous.provisioningCleanupMessage || '';
                endpoint.provisioningCleanupGroupIds = previous.provisioningCleanupGroupIds || [];
                endpoint.provisioningAttributeStatus = previous.provisioningAttributeStatus || '';
                endpoint.provisioningAttributeMessage = previous.provisioningAttributeMessage || '';
            } else {
                endpoint.provisioningStatus = provisioning.status;
                endpoint.provisioningDetail = provisioning.detail;
                endpoint.automationResults = provisioning.automationResults;
                endpoint.provisioningCleanupStatus = previous?.provisioningCleanupStatus || '';
                endpoint.provisioningCleanupMessage = previous?.provisioningCleanupMessage || '';
                endpoint.provisioningCleanupGroupIds = previous?.provisioningCleanupGroupIds || [];
                endpoint.provisioningAttributeStatus = previous?.provisioningAttributeStatus || '';
                endpoint.provisioningAttributeMessage = previous?.provisioningAttributeMessage || '';
            }
        }

        const selectedAction1GroupSet = new Set(selectedAction1GroupIds.map(id => String(id || '').trim()).filter(Boolean));
        const completedEndpoints = endpoints.filter(endpoint => (
            endpoint.inAssignmentTarget &&
            endpoint.source === 'Synced' &&
            endpoint.action1EndpointId &&
            endpoint.provisioningStatus === 'Completed'
        ));
        if (completedEndpoints.length && selectedAction1GroupSet.size) {
            const headers = await getAction1Headers(action1ApiKey, action1ApiSecret, action1ApiBase);
            try {
                const attributeDefinition = await ensureAction1ProvisioningCustomAttribute(headers, action1ApiBase);
                if (attributeDefinition.changed) await updateProgress(attributeDefinition.message);
            } catch (attributeDefinitionError) {
                await updateProgress(`Warning: Could not verify Action1 provisioning custom attribute definition: ${attributeDefinitionError.response?.data?.error?.message || attributeDefinitionError.message}`);
            }
            for (const groupId of selectedAction1GroupIds.map(id => String(id || '').trim()).filter(Boolean)) {
                try {
                    const exclusion = await ensureAction1ProvisioningGroupExclusion(headers, action1OrgId, groupId, action1ApiBase);
                    if (exclusion.changed) await updateProgress(exclusion.message);
                } catch (exclusionError) {
                    await updateProgress(`Warning: Could not add provisioned-endpoint exclusion to ${selectedAction1GroupMap?.[groupId] || groupId}: ${exclusionError.response?.data?.error?.message || exclusionError.message}`);
                }
            }
            for (const endpoint of completedEndpoints) {
                const previous = findPreviousProvisioning(endpoint, previousProvisioning);
                if (!endpoint.provisioningCompletedByAttribute && previous?.provisioningAttributeStatus !== 'completed') {
                    try {
                        await setAction1EndpointProvisioningAttribute(headers, action1OrgId, endpoint.action1EndpointId, action1ApiBase);
                        endpoint.provisioningAttributeStatus = 'completed';
                        endpoint.provisioningAttributeMessage = `${ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE} set to ${ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE_VALUE}.`;
                        await updateProgress(`Marked ${endpoint.deviceName} as provisioned with Action1 custom attribute.`);
                    } catch (attributeError) {
                        endpoint.provisioningAttributeStatus = 'warning';
                        endpoint.provisioningAttributeMessage = attributeError.response?.data?.error?.message || attributeError.message;
                        await updateProgress(`Warning: Could not mark ${endpoint.deviceName} with Action1 provisioning custom attribute: ${endpoint.provisioningAttributeMessage}`);
                    }
                }

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
                    .filter(groupId => selectedAction1GroupSet.has(groupId) && endpointGroupIds.has(groupId) && !previousCleanupGroupIds.has(groupId));

                if (!groupsToRemove.length) continue;
                const cleanupMessages = [];
                const completedCleanupGroupIds = new Set(previousCleanupGroupIds);
                const successfulCleanupGroupIds = new Set();
                for (const groupId of groupsToRemove) {
                    try {
                        const cleanup = await removeAction1EndpointFromGroup(headers, action1OrgId, groupId, endpoint.action1EndpointId, action1ApiBase);
                        cleanupMessages.push(`${selectedAction1GroupMap?.[groupId] || groupId}: ${firstString(cleanup?.user_message, cleanup?.message, 'removed')}`);
                        completedCleanupGroupIds.add(groupId);
                        successfulCleanupGroupIds.add(groupId);
                    } catch (cleanupError) {
                        cleanupMessages.push(`${selectedAction1GroupMap?.[groupId] || groupId}: ${cleanupError.response?.data?.error?.message || cleanupError.message}`);
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
                endpoint.provisioningStatus = 'Completed';
                endpoint.provisioningDetail = `${ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE} is ${ACTION1_PROVISIONING_CUSTOM_ATTRIBUTE_VALUE}.`;
                endpoint.automationResults = [];
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
async function createIntuneApp(graphHeaders, msiBuffer, msiFileName, version, productCode) {
    const graphBase = INTUNE_GRAPH_BASE;
    let appId = null;

    const largeIcon = await getAction1LargeIcon();
    const intuneContentFileName = 'IntunePackage.intunewin';

    // 1. Create the app shell
    const appBody = {
        "@odata.type": "#microsoft.graph.win32LobApp",
        displayName: "Action1 Agent",
        description: "Action1 Remote Monitoring and Management Agent",
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

async function getPreviousEndpointRegistration() {
    try {
        const previousData = JSON.parse(await getSetting('IntuneVersionData') || '{}');
        const previousRegistration = previousData?.endpointRegistration;
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
        const IntuneAgentId = await getSetting('IntuneAgentId');
        const IntuneOrgName = await getSetting('IntuneOrgName');
        const assignmentMode = normalizeAssignmentMode(await getSetting('IntuneAssignmentTargetMode'));
        const selectedGroupIds = parseSelectedGroupIds(await getSetting('IntuneDeviceGroupIds'));
        const selectedGroupMap = parseSelectedGroupMap(await getSetting('IntuneDeviceGroupMap'));
        const selectedAction1GroupIds = parseSelectedGroupIds(await getSetting('IntuneProvisioningAction1GroupIds'));
        const selectedAction1GroupMap = parseSelectedGroupMap(await getSetting('IntuneProvisioningAction1GroupMap'));
        const action1Credentials = await getAction1Credentials();

        if (!IntuneTenantId || !IntuneClientId || !IntuneClientSecret) throw new Error("Intune credentials missing.");
        if (!IntuneAgentId || !IntuneOrgName) throw new Error("Action1 Agent ID and Org Name are required.");
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

        // 2. Download latest Action1 Agent MSI
        await updateProgress("Downloading latest Action1 Agent MSI...");
        const { msiFileName, downloadUrl } = buildAction1AgentDownloadUrl(IntuneAgentId, IntuneOrgName, action1ConsoleUrl(action1Credentials));

        const msiRes = await axios.get(downloadUrl, { responseType: 'arraybuffer', timeout: 120000, validateStatus: () => true });
        const msiBuffer = Buffer.from(msiRes.data);
        assertMsiDownload(msiRes, msiBuffer);
        const latestVersion = extractMsiVersion(msiBuffer) || 'Unknown';
        const productCode = extractMsiProductCode(msiBuffer);

        if (latestVersion === 'Unknown') {
            throw new Error("Could not determine version from downloaded Action1 Agent MSI.");
        }
        await updateProgress(`Latest Action1 Agent version: ${latestVersion}`);

        // 3. Check for existing Intune Win32 LOB app
        await updateProgress("Checking Intune for existing Action1 Agent app...");
        let intuneVersion = 'Not Found';
        let intuneAppId = null;
        let intuneAppName = null;
        let action = 'none';

        try {
            const appsRes = await axios.get(
                `${INTUNE_GRAPH_BASE}/deviceAppManagement/mobileApps?$filter=isof('microsoft.graph.win32LobApp')`,
                { headers: graphHeaders }
            );
            const apps = appsRes.data.value || [];
            const action1App = apps.find(app => app.displayName && app.displayName.toLowerCase().includes('action1'));

            if (action1App) {
                const hasCommittedContentField = Object.prototype.hasOwnProperty.call(action1App, 'committedContentVersion');
                if (hasCommittedContentField && !action1App.committedContentVersion) {
                    await updateProgress(`Found incomplete Action1 Agent app "${action1App.displayName}". Removing it before recreating...`);
                    await deleteIntuneApp(graphHeaders, action1App.id);
                    await new Promise(r => setTimeout(r, 3000));
                    await updateProgress("Removed incomplete Intune app.");
                } else {
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
                }
            } else {
                await updateProgress("No Action1 Agent app found in Intune.");
            }
        } catch (e) {
            await updateProgress(`Warning: Could not query Intune apps: ${e.response?.data?.error?.message || e.message}`);
        }

        // 4. Decide action
        if (!intuneAppId) {
            // App doesn't exist — create it
            action = 'create';
            await updateProgress(`Creating new Action1 Agent app v${latestVersion} in Intune...`);

            try {
                intuneAppId = await createIntuneApp(graphHeaders, msiBuffer, msiFileName, latestVersion, productCode);
                intuneVersion = latestVersion;
                intuneAppName = 'Action1 Agent';
                await updateProgress(`Successfully created Action1 Agent v${latestVersion} in Intune.`);
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
                await updateProgress("Removed old Intune app. Creating updated version...");
                await new Promise(r => setTimeout(r, 3000)); // Give Graph API a moment

                // Create new app
                intuneAppId = await createIntuneApp(graphHeaders, msiBuffer, msiFileName, latestVersion, productCode);
                intuneVersion = latestVersion;
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

        let assignmentStatus = 'not_checked';
        let assignmentMessage = 'Assignments were not checked.';
        if (intuneAppId && !action.includes('failed')) {
            try {
                const assignmentTarget = describeDesiredAssignments(assignmentMode, selectedGroupIds);
                await updateProgress(`Configuring Intune assignment target: ${assignmentTarget}...`);
                await assignIntuneApp(graphHeaders, intuneAppId, assignmentMode, selectedGroupIds);
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

        const previousEndpointRegistration = await getPreviousEndpointRegistration();
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
            intuneAppName: intuneAppName || 'Action1 Agent',
            versionStatus,
            lastAction: action,
            assignmentMode,
            selectedGroupIds,
            selectedGroupMap,
            assignmentStatus,
            assignmentMessage,
            endpointRegistration,
            checkedAt: new Date().toISOString()
        });

        await new Promise(r => db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('IntuneVersionData', ?)`, [resultData], r));
        
        const failureReasons = [];
        if (action.includes('failed')) failureReasons.push(`Action failed: ${action}`);
        if (assignmentStatus === 'failed') failureReasons.push(`Assignment failed: ${assignmentMessage}`);
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
  sync
};
