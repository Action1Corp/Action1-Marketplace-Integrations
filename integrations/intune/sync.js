let axios;
let db;
let getSetting;
let getAction1Credentials;
let computeAndSaveRunMetrics;
let nvdService;



const crypto = require('crypto');

const ACTION1_APP_IMAGE_URL = 'https://www.action1.com/wp-content/uploads/2025/03/Action1_2560x1600.png';
const ACTION1_APP_INFORMATION_URL = 'https://www.action1.com/documentation/';
const ACTION1_APP_PRIVACY_URL = 'https://www.action1.com/legal/privacy-policy/';
const INTUNE_GRAPH_BASE = 'https://graph.microsoft.com/beta';
const ASSIGNMENT_MODE_ALL_DEVICES = 'allDevices';
const ASSIGNMENT_MODE_SELECTED_GROUPS = 'selectedGroups';


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

function buildAction1AgentDownloadUrl(agentId, orgName) {
    const msiFileName = `agent(${orgName}).msi`;
    return {
        msiFileName,
        downloadUrl: `https://app.action1.com/agent/${encodeURIComponent(agentId)}/Windows/${encodeURIComponent(msiFileName)}`
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

    // Upload payload: hmac(32) + iv(16) + encrypted_data
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

async function fetchAction1ManagedEndpoints(action1ApiKey, action1ApiSecret, action1OrgId) {
    const tokenParams = new URLSearchParams();
    tokenParams.append('client_id', action1ApiKey);
    tokenParams.append('client_secret', action1ApiSecret);
    tokenParams.append('grant_type', 'client_credentials');
    const tokenRes = await axios.post('https://app.action1.com/api/3.0/oauth2/token', tokenParams, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    const headers = { Authorization: `Bearer ${tokenRes.data.access_token}`, Accept: 'application/json' };
    const response = await axios.get(`https://app.action1.com/api/3.0/endpoints/managed/${action1OrgId}?limit=9999`, { headers });
    const payload = response.data;
    if (Array.isArray(payload)) return payload;
    return payload.items || payload.data || payload.endpoints || [];
}

function addGroupMemberKey(groupMembershipByDeviceKey, key, groupName) {
    const normalizedKey = String(key || '').trim().toLowerCase();
    if (!normalizedKey || !groupName) return;
    if (!groupMembershipByDeviceKey.has(normalizedKey)) groupMembershipByDeviceKey.set(normalizedKey, new Set());
    groupMembershipByDeviceKey.get(normalizedKey).add(groupName);
}

async function fetchDeviceGroupMembership(graphHeaders) {
    const groupMembershipByDeviceKey = new Map();
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
        }
    }
    return { groupMembershipByDeviceKey, redactedDeviceMembers };
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

async function compareIntuneDevicesToAction1(graphHeaders) {
    const { apiKey: action1ApiKey, apiSecret: action1ApiSecret, organizationId: action1OrgId } = await getAction1Credentials();
    if (!action1ApiKey || !action1ApiSecret || !action1OrgId) {
        return {
            status: 'skipped',
            message: 'Action1 API credentials are not configured.',
            intuneTotal: 0,
            action1Total: 0,
            registeredInAction1: 0,
            missingFromAction1: 0,
            matchRate: 0,
            missingDevices: []
        };
    }

    const [intuneDevices, action1Endpoints, groupMembership] = await Promise.all([
        fetchGraphCollection(graphHeaders, `${INTUNE_GRAPH_BASE}/deviceManagement/managedDevices?$top=999`),
        fetchAction1ManagedEndpoints(action1ApiKey, action1ApiSecret, action1OrgId),
        fetchDeviceGroupMembership(graphHeaders)
    ]);
    const groupMembershipByDeviceKey = groupMembership.groupMembershipByDeviceKey;
    const groupMembershipStatus = groupMembership.redactedDeviceMembers > 0 ? 'limited_permissions' : 'checked';
    const groupMembershipMessage = groupMembership.redactedDeviceMembers > 0
        ? 'Microsoft Graph returned redacted device group members. Add Directory.Read.All or Device.Read.All application permission with admin consent to show endpoint device group names.'
        : '';

    const action1Names = new Set();
    for (const endpoint of action1Endpoints) {
        const name = normalizeEndpointName(firstString(endpoint.device_name, endpoint.name, endpoint.hostname, endpoint.endpoint_name));
        if (name) action1Names.add(name);
    }

    let registeredInAction1 = 0;
    const missingDevices = [];
    for (const device of intuneDevices) {
        const deviceName = firstString(device.deviceName, device.managedDeviceName, device.name);
        const normalizedName = normalizeEndpointName(deviceName);
        const registered = normalizedName && action1Names.has(normalizedName);
        if (registered) {
            registeredInAction1 += 1;
        } else {
            const deviceGroupNames = getDeviceGroupNames(device, groupMembershipByDeviceKey);
            missingDevices.push({
                deviceName: deviceName || device.id || 'Unknown device',
                deviceGroups: deviceGroupNames,
                os: firstString(device.operatingSystem, device.osVersion),
                userPrincipalName: firstString(device.userPrincipalName, device.emailAddress),
                lastSyncDateTime: device.lastSyncDateTime || '',
                azureADDeviceId: device.azureADDeviceId || device.azureAdDeviceId || '',
                intuneDeviceId: device.id || ''
            });
        }
    }

    const intuneTotal = intuneDevices.length;
    const missingFromAction1 = missingDevices.length;
    const matchRate = intuneTotal > 0 ? Math.round((registeredInAction1 / intuneTotal) * 100) : 0;
    return {
        status: 'checked',
        message: `${registeredInAction1} of ${intuneTotal} Intune endpoints are registered in Action1.`,
        intuneTotal,
        action1Total: action1Endpoints.length,
        registeredInAction1,
        missingFromAction1,
        matchRate,
        groupMembershipStatus,
        groupMembershipMessage,
        missingDevices: missingDevices.slice(0, 50)
    };
}

/** Create a new Win32 LOB app in Intune and upload the MSI content */
async function createIntuneApp(graphHeaders, msiBuffer, msiFileName, version, productCode) {
    const graphBase = INTUNE_GRAPH_BASE;
    let appId = null;

    const largeIcon = await getAction1LargeIcon();

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
        fileName: msiFileName,
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
            productVersionOperator: "greaterThanOrEqual",
            productVersion: version
        }] : [{
            "@odata.type": "#microsoft.graph.win32LobAppFileSystemDetection",
            path: "C:\\Program Files\\Action1",
            fileOrFolderName: "agent_service.exe",
            check32BitOn64System: false,
            detectionType: "exists"
        }],
        requirementRules: [{
            "@odata.type": "#microsoft.graph.win32LobAppRegistryRequirement",
            operator: "greaterThanOrEqual",
            detectionValue: "10.0.19041",
            keyPath: "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion",
            valueName: "CurrentBuildNumber",
            check32BitOn64System: false,
            detectionType: "version"
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

    // 3. Encrypt the MSI
    const enc = encryptForIntune(msiBuffer);

    // 4. Create content file entry
    const fileBody = {
        "@odata.type": "#microsoft.graph.mobileAppContentFile",
        name: msiFileName,
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
        const { msiFileName, downloadUrl } = buildAction1AgentDownloadUrl(IntuneAgentId, IntuneOrgName);

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

        let endpointRegistration = {
            status: 'not_checked',
            message: 'Endpoint registration was not checked.',
            intuneTotal: 0,
            action1Total: 0,
            registeredInAction1: 0,
            missingFromAction1: 0,
            matchRate: 0,
            missingDevices: []
        };
        try {
            await updateProgress('Comparing Intune managed devices to Action1 endpoints...');
            endpointRegistration = await compareIntuneDevicesToAction1(graphHeaders);
            await updateProgress(endpointRegistration.message);
        } catch (registrationError) {
            endpointRegistration = {
                ...endpointRegistration,
                status: 'failed',
                message: registrationError.response?.data?.error?.message || registrationError.message
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
        
        const finalStatus = (action.includes('failed')) ? 'Failed' : 'Success';
        await updateProgress(`Check complete. Action: ${action} | Latest: v${latestVersion} | Intune: v${intuneVersion} | Assignments: ${assignmentStatus}`, finalStatus);

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
