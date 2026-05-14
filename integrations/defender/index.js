const { validateAction1, validateDefender } = require('../_shared/validation');

let axios;
let db;
let getSetting;
let computeAndSaveRunMetrics;
let nvdService;

async function validate({ settings }) {
  return {
    defender: await validateDefender(settings),
    action1: await validateAction1(settings)
  };
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

    const rank = { Critical: 4, High: 3, Medium: 2, Low: 1, Unknown: 0 };
    const existingScore = existing.cvss;
    const nextScore = next.cvss;
    const existingHasScore = existingScore !== null && existingScore !== undefined;
    const nextHasScore = nextScore !== null && nextScore !== undefined;

    if (nextHasScore && !existingHasScore) return next;
    if (nextHasScore && existingHasScore && nextScore >= existingScore) return next;
    if (!nextHasScore && !existingHasScore && rank[next.severity] >= rank[existing.severity]) return next;

    return existing;
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
            cves[cveId] = chooseCveEntry(cves[cveId], {
                cve: cveId,
                severity,
                cvss: Number.isNaN(score) ? null : score,
                status: 'Patch Available'
            });
        }

        if (items.length === 0 || items.length < limit) break;
        offset += limit;
        if (totalItems > 0 && offset >= totalItems) break;
        if (offset > 100000) break;
    }

    const counts = countBySeverity(cves);
    if (counts.total === 0) counts.total = Object.keys(cves).length;
    return { ...counts, cves };
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
        if (!DefenderBaseUrl) { DefenderBaseUrl = 'https://api.securitycenter.microsoft.com'; }
        DefenderBaseUrl = DefenderBaseUrl.replace(/\/$/, '');

        const action1Id = await getSetting('Action1APIKey');
        const action1Secret = await getSetting('Action1APISecret');
        const action1Org = await getSetting('Action1OrgID');

        if (!DefenderTenantId || !DefenderClientId || !DefenderClientSecret) throw new Error("Defender credentials missing.");
        if (!action1Id || !action1Secret || !action1Org) throw new Error("Action1 credentials missing.");

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
        const a1Base = 'https://app.action1.com/api/3.0';
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
            const mRes = await axios.get(`${DefenderBaseUrl}/api/machines?$top=500&$skip=${skip}`, {
                headers: { 'Authorization': `Bearer ${dToken}` }
            });
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
            const vRes = await axios.get(`${DefenderBaseUrl}/api/vulnerabilities/machinesVulnerabilities?$top=500&$skip=${vSkip}`, {
                headers: { 'Authorization': `Bearer ${dToken}` }
            });
            const vulns = vRes.data.value || [];

            vulns.forEach(v => {
                if (!v.machineId || !v.cveId) return;
                const mInfo = dMachineMap[v.machineId];
                if (!mInfo) return;
                rawVulns.push({ name: mInfo.name, cveId: v.cveId, severity: v.severity || 'Low' });
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
                        action1Vulns[v.cve_id] = { hasUpdates, score: isNaN(score) ? null : score, severity: v.severity };
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
            const { name, cveId, severity: defSeverity } = rv;
            
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
                hostCVEMap[cveId] = {
                    cve: cveId,
                    severity: finalSevLabel,
                    cvss: finalScore,
                    status: a1 ? (a1.hasUpdates ? 'Patch Available' : 'No Patch Available') : 'Not Recognized'
                };
            }
        }

        // Finalize lists and counts
        const finalCVEList = [];
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

                finalCVEList.push({
                    integration_id: 'defender',
                    endpoint_name: name,
                    cve: cveId,
                    severity: s,
                    status: cveData.status,
                    plugin_name: cveId,
                    description: '',
                    solution: ''
                });
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
        const epIdsForSync = endpointsToSave.filter(e => e.action1_id).map(e => e.action1_id);
        const authoritativeCounts = {};
        
        if (epIdsForSync.length > 0) {
            await updateProgress(`Fetching authoritative Action1 patch counts for ${epIdsForSync.length} endpoints...`);
            const batchSize = 10;
            for (let i = 0; i < epIdsForSync.length; i += batchSize) {
                const batch = epIdsForSync.slice(i, i + batchSize);
                await Promise.all(batch.map(async (id) => {
                    try {
                        authoritativeCounts[id] = await fetchAction1EndpointVulnCounts(a1Base, action1Org, id, a1Headers);
                    } catch (e) { authoritativeCounts[id] = null; }
                }));
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
                    const finalPatchCount = action1Counts ? action1Counts.total : 0;

                    db.run(`INSERT INTO endpoints (integration_id, run_id, endpoint_name, ipv4, mac, os, action1_id, tenable_has_agent, missing_from_tenable, missing_from_action1, defender_total_vulns, critical_vulns, high_vulns, medium_vulns, low_vulns, action1_critical_vulns, action1_high_vulns, action1_medium_vulns, action1_low_vulns, patchable_vulns)
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
                    `INSERT OR REPLACE INTO cve_details (cve, plugin_name, description, solution) VALUES (?, ?, ?, ?)`
                );
                for (let cve of finalCVEList) {
                    if (cve.plugin_name) {
                        stmtDetails.run(cve.cve, cve.plugin_name || '', null, null);
                    }
                }
                stmtDetails.finalize();

                // Insert endpoint_cves rows without text blobs
                let stmt2 = db.prepare(`INSERT INTO endpoint_cves (integration_id, run_id, endpoint_name, cve, severity, status)
                    VALUES (?, ?, ?, ?, ?, ?)`);
                for (let cve of finalCVEList) {
                    stmt2.run([cve.integration_id, runId, cve.endpoint_name, cve.cve, cve.severity, cve.status]);
                }
                stmt2.finalize();

                db.run('COMMIT', (err) => {
                    if (err) rejectDb(err); else resolveDb();
                });
            });
        });

        db.run(`DELETE FROM endpoints WHERE integration_id = 'defender' AND run_id != ?`, [runId]);
        db.run(`DELETE FROM endpoint_cves WHERE integration_id = 'defender' AND run_id != ?`, [runId]);

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
  computeAndSaveRunMetrics = context.services.computeAndSaveRunMetrics;
  nvdService = context.services.nvd;
  return runSync();
}

module.exports = {
  validate,
  sync
};
