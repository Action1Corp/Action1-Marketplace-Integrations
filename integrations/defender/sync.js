let axios;
let db;
let getSetting;
let getAction1Credentials;
let computeAndSaveRunMetrics;
let nvdService;
const DEFAULT_ACTION1_BASE_URL = 'https://app.action1.com/api/3.0';

function action1BaseUrl(credentials = {}) {
    return String(credentials.baseUrl || DEFAULT_ACTION1_BASE_URL).replace(/\/+$/, '');
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableNetworkError(error) {
    const code = error?.code || error?.cause?.code;
    const status = error?.response?.status;
    return ['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED'].includes(code)
        || status === 408
        || status === 429
        || (status >= 500 && status < 600);
}

function cleanBaseUrl(value, fallback) {
    return String(value || fallback || '')
        .trim()
        .replace(/^['"]+|['"]+$/g, '')
        .replace(/\/$/, '');
}

async function defenderGetWithRetry(url, config = {}, label = 'Microsoft Defender API request') {
    const attempts = 4;
    let lastError;

    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            return await axios.get(url, {
                timeout: 30000,
                ...config
            });
        } catch (error) {
            lastError = error;
            if (!isRetryableNetworkError(error) || attempt === attempts) break;

            const code = error?.code || error?.cause?.code || error?.response?.status || error.message;
            const delayMs = attempt * 2000;
            await updateProgress(`${label} failed with ${code}. Retrying ${attempt + 1}/${attempts}...`);
            await sleep(delayMs);
        }
    }

    throw lastError;
}



function updateProgress(details, status = 'Running') {
    console.log(`[Defender] ${details}`);
    return new Promise((resolve) => {
        const ts = new Date().toLocaleTimeString();
        db.get('SELECT id, details FROM sync_history WHERE integration_id = ? ORDER BY id DESC LIMIT 1', ['defender'], (err, row) => {
            if (row) {
                const newDetails = (row.details ? row.details + '\n' : '') + `${ts} - ${details}`;
                db.run('UPDATE sync_history SET status = ?, details = ? WHERE id = ?', [status, newDetails, row.id], (err) => resolve());
            } else resolve();
        });
    });
}

function normalizeSeverityLabel(value, scoreValue) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'critical') return 'Critical';
    if (normalized === 'high') return 'High';
    if (normalized === 'medium') return 'Medium';
    if (normalized === 'low') return 'Low';

    const score = parseFloat(scoreValue);
    if (!Number.isNaN(score)) {
        if (score >= 9.0) return 'Critical';
        if (score >= 7.0) return 'High';
        if (score >= 4.0) return 'Medium';
        if (score > 0) return 'Low';
    }

    return 'Low';
}

function chooseCveEntry(existing, next) {
    if (!existing) return next;

    const merged = { ...existing };
    if ((!merged.plugin_name || merged.plugin_name === merged.cve) && next.plugin_name && next.plugin_name !== next.cve) {
        merged.plugin_name = next.plugin_name;
    }
    if ((!merged.vulnerable_software || merged.vulnerable_software === merged.cve) && next.vulnerable_software && next.vulnerable_software !== next.cve) {
        merged.vulnerable_software = next.vulnerable_software;
    }
    if ((!merged.title || merged.title === merged.cve) && next.title && next.title !== next.cve) {
        merged.title = next.title;
    }

    const rank = { Critical: 4, High: 3, Medium: 2, Low: 1, Unknown: 0 };
    const existingScore = existing.cvss;
    const nextScore = next.cvss;
    const existingHasScore = existingScore !== null && existingScore !== undefined;
    const nextHasScore = nextScore !== null && nextScore !== undefined;

    if (nextHasScore && !existingHasScore) return { ...next, plugin_name: next.plugin_name || merged.plugin_name, vulnerable_software: next.vulnerable_software || merged.vulnerable_software, title: next.title || merged.title };
    if (nextHasScore && existingHasScore && nextScore >= existingScore) return { ...next, plugin_name: next.plugin_name || merged.plugin_name, vulnerable_software: next.vulnerable_software || merged.vulnerable_software, title: next.title || merged.title };
    if (!nextHasScore && !existingHasScore && rank[next.severity] >= rank[existing.severity]) return { ...next, plugin_name: next.plugin_name || merged.plugin_name, vulnerable_software: next.vulnerable_software || merged.vulnerable_software, title: next.title || merged.title };

    return merged;
}

function countBySeverity(cveMap = {}) {
    const counts = { Critical: 0, High: 0, Medium: 0, Low: 0 };

    for (const cveData of Object.values(cveMap)) {
        const severity = normalizeSeverityLabel(cveData.severity, cveData.cvss);
        counts[severity]++;
    }

    counts.total = counts.Critical + counts.High + counts.Medium + counts.Low;
    return counts;
}

function mergeCveMaps(...maps) {
    const merged = {};

    for (const map of maps) {
        for (const [cve, cveData] of Object.entries(map || {})) {
            merged[cve] = chooseCveEntry(merged[cve], cveData);
        }
    }

    return merged;
}

function hasAction1AvailableUpdates(vulnerability) {
    return Array.isArray(vulnerability?.software)
        && vulnerability.software.some((software) => Array.isArray(software.available_updates) && software.available_updates.length > 0);
}

function action1RemediationStatus(vulnerability) {
    return hasAction1AvailableUpdates(vulnerability) ? 'Patch Available' : 'Non Patchable';
}

function compactSoftwareNames(names) {
    return Array.from(new Set((names || [])
        .map((name) => String(name || '').trim())
        .filter(Boolean)))
        .sort()
        .join(', ');
}

function softwareNameFromDefenderVulnerability(vulnerability) {
    return compactSoftwareNames([
        vulnerability.softwareName,
        vulnerability.software_name,
        vulnerability.productName,
        vulnerability.product_name,
        vulnerability.product,
        vulnerability.vendor && vulnerability.product ? `${vulnerability.vendor} ${vulnerability.product}` : '',
        vulnerability.componentName,
        vulnerability.component_name
    ]);
}

function softwareNameFromAction1Vulnerability(vulnerability) {
    if (!Array.isArray(vulnerability?.software)) return '';
    return compactSoftwareNames(vulnerability.software.map((software) =>
        software.name ||
        software.software_name ||
        software.product_name ||
        software.product ||
        software.display_name ||
        software.title
    ));
}

async function fetchAction1EndpointVulnCounts(a1Base, action1Org, endpointId, headers) {
    const cves = {};
    const limit = 500;
    let offset = 0;

    while (true) {
        const vRes = await axios.get(`${a1Base}/Vulnerabilities/${action1Org}?endpoint_id=${endpointId}&limit=${limit}&from=${offset}`, { headers });
        const payload = vRes.data || {};
        const items = Array.isArray(payload) ? payload : (payload.items || payload.data || payload.vulnerabilities || []);
        const totalItems = Number(payload.total_items ?? payload.total ?? 0);

        for (const item of items) {
            const cveId = item.cve_id || item.cve || item.cveId;
            if (!cveId) continue;

            const score = parseFloat(item.cvss_v3_score || item.cvss_score || item.cvss);
            const severity = normalizeSeverityLabel(item.severity, score);
            const softwareName = softwareNameFromAction1Vulnerability(item);
                cves[cveId] = chooseCveEntry(cves[cveId], {
                cve: cveId,
                severity,
                cvss: Number.isNaN(score) ? null : score,
                status: action1RemediationStatus(item),
                patchable: hasAction1AvailableUpdates(item),
                plugin_name: softwareName,
                vulnerable_software: softwareName
            });
        }

        if (items.length === 0 || items.length < limit) break;
        offset += limit;
        if (totalItems > 0 && offset >= totalItems) break;
        if (offset > 100000) break;
    }

    const counts = countBySeverity(cves);
    const patchableTotal = Object.values(cves).filter((cve) => cve.patchable).length;
    return { ...counts, patchableTotal, cves };
}

async function runSync() {
    console.log('[Defender] Starting Defender Sync Engine...');
    try {
        await new Promise((resolve, reject) => {
            db.run(
                `INSERT INTO sync_history (integration_id, status, details, assets_processed) VALUES ('defender', 'Running', 'Started sync', 0)`,
                function(err) { if (err) reject(err); else resolve(); }
            );
        });
        await new Promise(r => setTimeout(r, 300)); // allow DB write

        const DefenderTenantId = await getSetting('DefenderTenantId');
        const DefenderClientId = await getSetting('DefenderClientId');
        const DefenderClientSecret = await getSetting('DefenderClientSecret');
        let DefenderBaseUrl = await getSetting('DefenderBaseUrl');
        DefenderBaseUrl = cleanBaseUrl(DefenderBaseUrl, 'https://api.securitycenter.microsoft.com');

        const action1Credentials = await getAction1Credentials();
        const { apiKey: action1Id, apiSecret: action1Secret, organizationId: action1Org } = action1Credentials;

        if (!DefenderTenantId || !DefenderClientId || !DefenderClientSecret) {
            throw new Error('Defender tenant ID, client ID, or client secret is not configured in integration settings.');
        }
        if (!action1Id || !action1Secret || !action1Org) {
            throw new Error('Action1 credentials are not configured. Configure and validate Action1 in Marketplace Settings.');
        }

        // 1. Auth Defender
        await updateProgress("Authenticating to Microsoft Defender...");
        const tokenParams = new URLSearchParams();
        tokenParams.append('client_id', DefenderClientId);
        tokenParams.append('scope', 'https://api.securitycenter.microsoft.com/.default');
        tokenParams.append('client_secret', DefenderClientSecret);
        tokenParams.append('grant_type', 'client_credentials');

        const authRes = await axios.post(`https://login.microsoftonline.com/${DefenderTenantId}/oauth2/v2.0/token`, tokenParams, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        const dToken = authRes.data.access_token;

        // 2. Auth Action1
        await updateProgress("Authenticating to Action1...");
        const a1Base = action1BaseUrl(action1Credentials);
        let a1Token = null;
        try {
            const a1Params = new URLSearchParams();
            a1Params.append('client_id', action1Id);
            a1Params.append('client_secret', action1Secret);
            a1Params.append('grant_type', 'client_credentials');
            const a1Auth = await axios.post(`${a1Base}/oauth2/token`, a1Params, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });
            a1Token = a1Auth.data.access_token;
        } catch (e) {
            throw new Error(`Action1 authentication failed: ${e.message}`);
        }
        const a1Headers = { 'Authorization': `Bearer ${a1Token}`, 'Accept': 'application/json' };

        // 3. Get Action1 Endpoints
        await updateProgress("Fetching Action1 endpoints...");
        const a1eps = {};
        let action1Assets = [];
        const epsRes = await axios.get(`${a1Base}/endpoints/managed/${action1Org}?limit=9999`, { headers: a1Headers });
        const payload = epsRes.data;
        if (Array.isArray(payload)) action1Assets = payload;
        else if (Array.isArray(payload.items)) action1Assets = payload.items;
        else if (Array.isArray(payload.data)) action1Assets = payload.data;
        else if (Array.isArray(payload.endpoints)) action1Assets = payload.endpoints;

        for (let ep of action1Assets) {
            if (!ep.device_name) continue;
            const name = ep.device_name.trim().split('.')[0].toLowerCase();
            a1eps[name] = { id: ep.id, device_name: ep.device_name, ipv4: ep.address, os: ep.OS, mac: ep.Mac };
        }
        await updateProgress(`Retrieved ${Object.keys(a1eps).length} Action1 endpoints.`);

        // 4. Fetch Defender Machines
        await updateProgress("Fetching Microsoft Defender machines...");
        let skip = 0;
        let DefenderMachines = [];
        let dMachineMap = {}; // id -> { dns, os }
        let dHostSeen = {};   // dns -> bool

        while (true) {
            const mRes = await defenderGetWithRetry(`${DefenderBaseUrl}/api/machines?$top=500&$skip=${skip}`, {
                headers: { 'Authorization': `Bearer ${dToken}` }
            }, 'Fetching Microsoft Defender machines');
            const vals = mRes.data.value || [];
            DefenderMachines.push(...vals);

            vals.forEach(m => {
                const rawName = m.computerDnsName;
                if (!rawName) return;
                const name = rawName.trim().split('.')[0].toLowerCase();
                dMachineMap[m.id] = { name, os: m.osPlatform || 'Unknown' };
                dHostSeen[name] = { id: m.id, ipv4: m.lastIpAddress || '', os: m.osPlatform || 'Unknown' };
            });

            if (vals.length < 500) break;
            skip += 500;
        }

        // 5. Fetch Defender Vulnerabilities
        await updateProgress(`Found ${DefenderMachines.length} Defender machines. Fetching vulnerabilities...`);
        let vSkip = 0;
        const rawVulns = []; // collect raw, categorize after catalog fetch

        while (true) {
            const vRes = await defenderGetWithRetry(`${DefenderBaseUrl}/api/vulnerabilities/machinesVulnerabilities?$top=500&$skip=${vSkip}`, {
                headers: { 'Authorization': `Bearer ${dToken}` }
            }, 'Fetching Microsoft Defender vulnerabilities');
            const vulns = vRes.data.value || [];

            vulns.forEach(v => {
                if (!v.machineId || !v.cveId) return;
                const mInfo = dMachineMap[v.machineId];
                if (!mInfo) return;
                rawVulns.push({
                    name: mInfo.name,
                    cveId: v.cveId,
                    severity: v.severity || 'Low',
                    plugin_name: softwareNameFromDefenderVulnerability(v)
                });
            });

            if (vulns.length < 500) break;
            vSkip += 500;
        }

        // 5b. Fetch Action1 Vulnerability Catalog for patch status
        await updateProgress(`Fetched ${rawVulns.length} Defender vulns. Checking Action1 patch catalog...`);
        let action1Vulns = {};
        try {
            let offset = 0;
            const limit = 5000;
            let totalFetched = 0;
            let hasMore = true;

            while (hasMore) {
                const catRes = await axios.get(`${a1Base}/Vulnerabilities/${action1Org}?limit=${limit}&from=${offset}`, { headers: a1Headers });
                const p = catRes.data;
                let catData = Array.isArray(p) ? p : (p.items || p.data || p.vulnerabilities || []);

                if (catData.length === 0) {
                    hasMore = false;
                } else {
                    for (let v of catData) {
                        let hasUpdates = false;
                        if (Array.isArray(v.software)) {
                            for (let s of v.software) {
                                if (s.available_updates && s.available_updates.length > 0) {
                                    hasUpdates = true; break;
                                }
                            }
                        }
                        const score = parseFloat(v.cvss_v3_score || v.cvss_score || v.cvss);
                        const softwareName = softwareNameFromAction1Vulnerability(v);
                        action1Vulns[v.cve_id] = {
                            hasUpdates,
                            remediationStatus: action1RemediationStatus(v),
                            score: isNaN(score) ? null : score,
                            severity: v.severity,
                            plugin_name: softwareName,
                            vulnerable_software: softwareName
                        };
                    }
                    totalFetched += catData.length;
                    offset += limit;
                    if (totalFetched >= (p.total_items || 50000)) hasMore = false;
                    if (offset > 100000) hasMore = false;
                }
            }
            await updateProgress(`Cataloged ${totalFetched} Action1 vulnerabilities.`);
        } catch (e) {
            await updateProgress(`Failed fetching Action1 vuln catalog: ${e.response?.status || e.message}`);
        }

        // 5c. De-duplicate and Categorize using robust arbitration
        let endpointSeverityCounts = {};
        let endpointUniqueCVEs = {}; // name -> { cveId -> { cve, severity, cvss, status, ... } }

        await updateProgress("Fetching NIST CVSS scores for all unique CVEs to guarantee strict accuracy...");
        const allDiscoveredCVEs = new Set();
        for (const rv of rawVulns) {
            if (rv.cveId) allDiscoveredCVEs.add(rv.cveId.trim());
        }
        const cveArr = Array.from(allDiscoveredCVEs);
        if (cveArr.length > 0) {
            await updateProgress(`Synchronizing ${cveArr.length} CVEs with NIST...`);
            const chunks = [];
            for (let i = 0; i < cveArr.length; i += 20) {
                chunks.push(cveArr.slice(i, i + 20));
            }
            for (let i = 0; i < chunks.length; i++) {
                await Promise.all(chunks[i].map(cve => nvdService.getScore(cve, true)));
                if (chunks.length > 1) {
                    await updateProgress(`Fetched batch ${i+1}/${chunks.length} from NIST...`);
                }
            }
        }

        await updateProgress(`Reconciling ${rawVulns.length} vulnerabilities with NIST ground truth...`);

        for (const rv of rawVulns) {
            const { name, cveId, severity: defSeverity, plugin_name } = rv;

            if (!endpointUniqueCVEs[name]) endpointUniqueCVEs[name] = {};
            const hostCVEMap = endpointUniqueCVEs[name];

            // Ground Truth Arbitration:
            // 1. NIST Cache
            // 2. Action1 Catalog
            // 3. Defender Score

            const nist = await nvdService.getFromCache(cveId);
            const a1 = action1Vulns[cveId];

            let finalSevLabel = 'Low';
            let finalScore = null;

            if (nist) {
                finalSevLabel = nist.severity;
                finalScore = nist.score;
            } else if (a1 && a1.score !== null) {
                finalSevLabel = a1.severity || 'Low';
                finalScore = a1.score;
            } else {
                // Defender fallback
                finalSevLabel = 'Low';
                if (defSeverity.toLowerCase() === 'critical') finalSevLabel = 'Critical';
                else if (defSeverity.toLowerCase() === 'high') finalSevLabel = 'High';
                else if (defSeverity.toLowerCase() === 'medium') finalSevLabel = 'Medium';
            }

            if (finalScore !== null) {
                await nvdService.saveToCache(cveId, finalScore, finalSevLabel);
            }

            // De-duplicate: Keep the highest score if multiple entries for same CVE
            const existing = hostCVEMap[cveId];
            let useNew = false;
            if (!existing) {
                useNew = true;
            } else {
                const existingHasScore = existing.cvss !== null;
                const newHasScore = finalScore !== null;
                if (newHasScore && !existingHasScore) useNew = true;
                else if (newHasScore && existingHasScore && finalScore >= existing.cvss) useNew = true;
                else if (!newHasScore && !existingHasScore) {
                    const sevRank = { 'Critical': 4, 'High': 3, 'Medium': 2, 'Low': 1, 'Unknown': 0 };
                    if (sevRank[finalSevLabel] >= sevRank[existing.severity]) useNew = true;
                }
            }

            if (useNew) {
                const softwareName = plugin_name || a1?.vulnerable_software || a1?.plugin_name || '';
                hostCVEMap[cveId] = {
                    cve: cveId,
                    severity: finalSevLabel,
                    cvss: finalScore,
                    status: a1 ? (a1.remediationStatus || 'Non Patchable') : 'Non Patchable',
                    plugin_name: softwareName,
                    vulnerable_software: softwareName
                };
            } else if ((!hostCVEMap[cveId].plugin_name || hostCVEMap[cveId].plugin_name === cveId) && (plugin_name || a1?.vulnerable_software || a1?.plugin_name)) {
                const softwareName = plugin_name || a1.vulnerable_software || a1.plugin_name;
                hostCVEMap[cveId].plugin_name = softwareName;
                hostCVEMap[cveId].vulnerable_software = softwareName;
            } else if ((!hostCVEMap[cveId].vulnerable_software || hostCVEMap[cveId].vulnerable_software === cveId) && (plugin_name || a1?.vulnerable_software || a1?.plugin_name)) {
                hostCVEMap[cveId].vulnerable_software = plugin_name || a1.vulnerable_software || a1.plugin_name;
            }
        }

        // Finalize Defender-reported counts. Action1 CVEs are merged after
        // endpoint-level Action1 vulnerability details are fetched.
        for (let name in endpointUniqueCVEs) {
            endpointSeverityCounts[name] = { Critical: 0, High: 0, Medium: 0, Low: 0 };
            const hostCVEMap = endpointUniqueCVEs[name];
            for (let cveId in hostCVEMap) {
                const cveData = hostCVEMap[cveId];

                const s = cveData.severity;
                if (s === 'Critical') endpointSeverityCounts[name].Critical++;
                else if (s === 'High') endpointSeverityCounts[name].High++;
                else if (s === 'Medium') endpointSeverityCounts[name].Medium++;
                else if (s === 'Low') endpointSeverityCounts[name].Low++;
            }
        }


        // 6. Reconcile
        const runIdRes = await new Promise(r => db.get("SELECT id FROM sync_history WHERE integration_id = 'defender' ORDER BY id DESC LIMIT 1", (err, row) => r(row.id)));
        const runId = runIdRes;

        const endpointsToSave = [];

        for (let name in a1eps) {
            const a = a1eps[name];
            const has_vm = !!dHostSeen[name];
            const sevs = endpointSeverityCounts[name] || { Critical: 0, High: 0, Medium: 0, Low: 0 };
            endpointsToSave.push({
                integration_id: 'defender', run_id: runId, endpoint_name: name,
                ipv4: a.ipv4 || null, mac: a.mac || null, os: a.os || null, action1_id: a.id,
                has_agent: has_vm,
                missing_from_vm: !has_vm, missing_from_action1: false,
                critical: sevs.Critical, high: sevs.High, medium: sevs.Medium, low: sevs.Low
            });
        }
        for (let name in dHostSeen) {
            if (!a1eps[name]) {
                const d = dHostSeen[name];
                const sevs = endpointSeverityCounts[name] || { Critical: 0, High: 0, Medium: 0, Low: 0 };
                endpointsToSave.push({
                    integration_id: 'defender', run_id: runId, endpoint_name: name,
                    ipv4: d.ipv4, mac: null, os: d.os, action1_id: null,
                    has_agent: true,
                    missing_from_vm: false, missing_from_action1: true,
                    critical: sevs.Critical, high: sevs.High, medium: sevs.Medium, low: sevs.Low
                });
            }
        }

        // --- AUTHORITATIVE RECONCILIATION ---
        await updateProgress(`Saving ${endpointsToSave.length} endpoints...`);
        const epIdsForSync = Array.from(new Set(endpointsToSave
            .filter(e => e.action1_id)
            .map(e => e.action1_id)));
        const action1EndpointNamesById = endpointsToSave.reduce((names, endpoint) => {
            if (endpoint.action1_id) names[endpoint.action1_id] = endpoint.endpoint_name;
            return names;
        }, {});
        const authoritativeCounts = {};

        if (epIdsForSync.length > 0) {
            await updateProgress(`Fetching authoritative Action1 patch counts for ${epIdsForSync.length} endpoints...`);
            const batchSize = 10;
            let action1EndpointFetchFailures = 0;
            for (let i = 0; i < epIdsForSync.length; i += batchSize) {
                const batch = epIdsForSync.slice(i, i + batchSize);
                await Promise.all(batch.map(async (id) => {
                    try {
                        authoritativeCounts[id] = await fetchAction1EndpointVulnCounts(a1Base, action1Org, id, a1Headers);
                    } catch (e) {
                        action1EndpointFetchFailures++;
                        authoritativeCounts[id] = null;
                        await updateProgress(`Failed fetching Action1 endpoint vulnerability counts for ${action1EndpointNamesById[id] || id}: ${e.response?.status || e.message}`);
                    }
                }));
            }
            const action1EndpointFetchSuccesses = Object.values(authoritativeCounts).filter(Boolean).length;
            const action1EndpointCveTotal = Object.values(authoritativeCounts)
                .filter(Boolean)
                .reduce((total, counts) => total + (counts.total || 0), 0);
            await updateProgress(`Loaded Action1 endpoint vulnerability counts for ${action1EndpointFetchSuccesses}/${epIdsForSync.length} endpoints (${action1EndpointCveTotal} CVEs, ${action1EndpointFetchFailures} failures).`);
        }

        const finalCVEList = [];
        for (let ep of endpointsToSave) {
            const defenderCves = endpointUniqueCVEs[ep.endpoint_name] || {};
            const action1Counts = ep.action1_id ? authoritativeCounts[ep.action1_id] : null;
            const mergedCves = mergeCveMaps(defenderCves, action1Counts?.cves || {});

            for (const [cveId, action1Cve] of Object.entries(action1Counts?.cves || {})) {
                if (mergedCves[cveId]) {
                    mergedCves[cveId].status = action1Cve.status;
                    mergedCves[cveId].patchable = action1Cve.patchable;
                }
            }

            for (const [cveId, cveData] of Object.entries(mergedCves)) {
                const remediationStatus = ep.action1_id && cveData.patchable ? 'Patch Available' : 'Non Patchable';
                finalCVEList.push({
                    integration_id: 'defender',
                    endpoint_name: ep.endpoint_name,
                    cve: cveId,
                    severity: normalizeSeverityLabel(cveData.severity, cveData.cvss),
                    status: remediationStatus,
                    source: defenderCves[cveId] && action1Counts?.cves?.[cveId] ? 'Both' : action1Counts?.cves?.[cveId] ? 'Action1' : 'VM Scanner',
                    plugin_name: cveData.plugin_name || cveData.title || cveId,
                    vulnerable_software: cveData.vulnerable_software || cveData.plugin_name || '',
                    description: '',
                    solution: ''
                });
            }
        }

        await new Promise((resolveDb, rejectDb) => {
            db.serialize(() => {
                db.run('BEGIN TRANSACTION');

                for (let ep of endpointsToSave) {
                    const action1Counts = ep.action1_id ? authoritativeCounts[ep.action1_id] : null;
                    const defenderCves = endpointUniqueCVEs[ep.endpoint_name] || {};
                    const defenderCounts = countBySeverity(defenderCves);
                    const mergedCounts = countBySeverity(mergeCveMaps(defenderCves, action1Counts?.cves || {}));
                    const finalPatchCount = action1Counts ? action1Counts.patchableTotal : 0;

                    db.run(`INSERT INTO defender_endpoints (integration_id, run_id, endpoint_name, ipv4, mac, os, action1_id, tenable_has_agent, missing_from_tenable, missing_from_action1, defender_total_vulns, critical_vulns, high_vulns, medium_vulns, low_vulns, action1_critical_vulns, action1_high_vulns, action1_medium_vulns, action1_low_vulns, patchable_vulns)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            ep.integration_id, runId, ep.endpoint_name, ep.ipv4, ep.mac, ep.os, ep.action1_id,
                            ep.has_agent, ep.missing_from_vm, ep.missing_from_action1,
                            defenderCounts.total,
                            mergedCounts.Critical,
                            mergedCounts.High,
                            mergedCounts.Medium,
                            mergedCounts.Low,
                            action1Counts?.Critical || 0,
                            action1Counts?.High || 0,
                            action1Counts?.Medium || 0,
                            action1Counts?.Low || 0,
                            finalPatchCount
                        ]);
                }

                // Upsert CVE text into normalized lookup table
                const stmtDetails = db.prepare(
                    `INSERT OR REPLACE INTO cve_details (cve, plugin_name, description, solution, vulnerable_software) VALUES (?, ?, ?, ?, ?)`
                );
                for (let cve of finalCVEList) {
                    if (cve.plugin_name) {
                        stmtDetails.run(cve.cve, cve.plugin_name || '', null, null, cve.vulnerable_software || cve.plugin_name || '');
                    }
                }
                stmtDetails.finalize();

                // Insert endpoint_cves rows without text blobs
                let stmt2 = db.prepare(`INSERT INTO defender_endpoint_cves (integration_id, run_id, endpoint_name, cve, severity, status, source)
                    VALUES (?, ?, ?, ?, ?, ?, ?)`);
                for (let cve of finalCVEList) {
                    stmt2.run([cve.integration_id, runId, cve.endpoint_name, cve.cve, cve.severity, cve.status, cve.source]);
                }
                stmt2.finalize();

                db.run('COMMIT', (err) => {
                    if (err) rejectDb(err); else resolveDb();
                });
            });
        });

        db.run(`DELETE FROM defender_endpoints WHERE run_id != ?`, [runId]);
        db.run(`DELETE FROM defender_endpoint_cves WHERE run_id != ?`, [runId]);

        await computeAndSaveRunMetrics(runId, 'defender');

        await updateProgress(`Sync complete. Saved ${endpointsToSave.length} assets.`, 'Success');
        db.run(`UPDATE sync_history SET assets_processed = ? WHERE id = ?`, [endpointsToSave.length, runId]);

    } catch (e) {
        console.error("Defender Sync Error:", e);
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
