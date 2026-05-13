const axios = require('axios');
const { db, getSetting, initDb, computeAndSaveRunMetrics } = require('../database');
const nvdService = require('./nvdService');

// Wait utility
const delay = ms => new Promise(res => setTimeout(res, ms));

async function runSync() {
    initDb();
    console.log("Starting CrowdStrike Sync Engine...");
    
    // Create new Run ID
    const runId = await new Promise((resolve, reject) => {
        db.run('INSERT INTO sync_history (integration_id, status, details) VALUES (?, ?, ?)', ['crowdstrike', 'Running', 'Started sync'], function(err) {
            if (err) reject(err);
            else resolve(this.lastID);
        });
    });

    let fullLogStr = "Started sync\n";
    const updateProgress = async (msg) => {
        console.log(`[CrowdStrike] ${msg}`);
        fullLogStr += `${new Date().toISOString().substring(11,19)} - ${msg}\n`;
        await new Promise((resolve) => {
            db.run('UPDATE sync_history SET details = ? WHERE id = ?', [fullLogStr, runId], resolve);
        });
    };

    try {
        const CrowdStrikeClientId = await getSetting('CrowdStrikeClientId');
        const CrowdStrikeClientSecret = await getSetting('CrowdStrikeClientSecret');
        const CrowdStrikeBaseUrl = (await getSetting('CrowdStrikeBaseUrl')) || 'https://api.crowdstrike.com';
        
        const Action1APIKey = await getSetting('Action1APIKey');
        const Action1APISecret = await getSetting('Action1APISecret');
        const Action1OrgID = await getSetting('Action1OrgID');

        if (!CrowdStrikeClientId || !CrowdStrikeClientSecret || !Action1APIKey || !Action1OrgID) {
            throw new Error('CrowdStrike or Action1 API keys are not fully configured.');
        }

        // 1. Authenticate with CrowdStrike
        await updateProgress("Authenticating with CrowdStrike Falcon API...");
        let csToken = null;
        try {
            const params = new URLSearchParams();
            params.append('client_id', CrowdStrikeClientId);
            params.append('client_secret', CrowdStrikeClientSecret);
            const authRes = await axios.post(`${CrowdStrikeBaseUrl}/oauth2/token`, params, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });
            csToken = authRes.data.access_token;
        } catch (e) {
            throw new Error(`CrowdStrike authentication failed: ${e.message}`);
        }

        const csHeaders = { 'Authorization': `Bearer ${csToken}`, 'Accept': 'application/json' };
        const a1Base = "https://app.action1.com/api/3.0";

        // 2. Authenticate with Action1
        await updateProgress("Authenticating with Action1...");
        let a1Token = null;
        try {
            const tokenParams = new URLSearchParams();
            tokenParams.append('client_id', Action1APIKey);
            tokenParams.append('client_secret', Action1APISecret);
            const tokenRes = await axios.post('https://app.action1.com/api/3.0/oauth2/token', tokenParams, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });
            a1Token = tokenRes.data.access_token;
        } catch (e) {
            throw new Error(`Action1 authentication failed: ${e.message}`);
        }
        const a1Headers = { 'Authorization': `Bearer ${a1Token}`, 'Accept': 'application/json' };

        // 3. Fetch Action1 Endpoints
        await updateProgress("Retrieving Action1 endpoints...");
        let action1Assets = [];
        const a1Res = await axios.get(`${a1Base}/endpoints/managed/${Action1OrgID}?limit=9999`, { headers: a1Headers });
        action1Assets = a1Res.data.items || a1Res.data.data || a1Res.data.endpoints || (Array.isArray(a1Res.data) ? a1Res.data : []);
        
        let a1eps = {};
        for (let ep of action1Assets) {
            if (!ep.device_name) continue;
            let name = ep.device_name.trim().split('.')[0].toLowerCase();
            a1eps[name] = { id: ep.id, device_name: ep.device_name, ipv4: ep.address, os: ep.OS, mac: ep.Mac };
        }
        await updateProgress(`Retrieved ${Object.keys(a1eps).length} Action1 endpoints.`);

        // 4. Fetch CrowdStrike Vulnerabilities (Spotlight)
        await updateProgress("Fetching CrowdStrike Spotlight vulnerabilities...");
        let allVulns = [];
        let afterToken = null;
        let page = 1;

        do {
            const filter = "status:['open','reopen']";
            let uri = `${CrowdStrikeBaseUrl}/spotlight/combined/vulnerabilities/v1?limit=400&filter=${encodeURIComponent(filter)}&facet=host_info&facet=cve`;
            if (afterToken) uri += `&after=${afterToken}`;

            const resp = await axios.get(uri, { headers: csHeaders });
            const resources = resp.data.resources || [];
            allVulns = allVulns.concat(resources);
            
            afterToken = resp.data.meta?.pagination?.after;
            if (resources.length > 0) {
                await updateProgress(`Retrieved page ${page} (${resources.length} vulns)...`);
            }
            page++;
            if (page > 50) break; // Safety break
        } while (afterToken);

        let eps = {}; // map of endpoint to cve list
        let cveDetails = {};
        for (let v of allVulns) {
            if (!v.host_info?.hostname || !v.cve?.id) continue;
            let epName = v.host_info.hostname.trim().split('.')[0].toLowerCase();
            let cve = v.cve.id;

            if (!eps[epName]) eps[epName] = [];
            eps[epName].push(cve);
            
            cveDetails[cve] = {
                Description: v.cve?.description || "",
                Solution: v.remediation?.entities?.[0]?.description || "Refer to CrowdStrike documentation.",
                Severity: v.cve?.severity || "Unknown",
                PluginName: "CrowdStrike Spotlight"
            };
        }

        // 5. Fetch Action1 Vulnerability Catalog (Paginated)
        await updateProgress("Fetching Action1 vulnerability catalog...");
        let action1Vulns = {};
        try {
            let offset = 0;
            const limit = 5000;
            let totalFetched = 0;
            let hasMore = true;

            while (hasMore) {
                const catRes = await axios.get(`${a1Base}/Vulnerabilities/${Action1OrgID}?limit=${limit}&from=${offset}`, { headers: a1Headers });
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
            await updateProgress(`Action1 catalog loaded: ${totalFetched} vulnerabilities.`);
        } catch (e) {
            await updateProgress(`Failed fetching Action1 vuln catalog: ${e.response?.status || e.message}`);
        }

        // 6. Map CVEs & Severities (with de-duplication and NIST arbitration)
        await updateProgress("Mapping vulnerabilities to endpoints with NIST arbitration...");
        let finalCVEList = [];
        let endpointSeverityCounts = {};
        
        let endpointUniqueCVEs = {}; // ep -> { cveId -> { cve, severity, cvss, status, ... } }

        for (let ep in eps) {
            if (!endpointUniqueCVEs[ep]) endpointUniqueCVEs[ep] = {};
            const hostCVEMap = endpointUniqueCVEs[ep];
            
            let uniqueCvesRaw = [...new Set(eps[ep])];
            for (let cve of uniqueCvesRaw) {
                // Ground Truth Arbitration:
                const nist = await nvdService.getFromCache(cve);
                const a1 = action1Vulns[cve];
                const detail = cveDetails[cve];

                let finalSevLabel = 'Low';
                let finalScore = null;

                if (nist) {
                    finalSevLabel = nist.severity;
                    finalScore = nist.score;
                } else if (a1 && a1.score !== null) {
                    finalSevLabel = a1.severity || 'Low';
                    finalScore = a1.score;
                } else {
                    // CrowdStrike fallback
                    finalSevLabel = 'Low';
                    let csSev = (detail.Severity || "Unknown").toUpperCase();
                    if (csSev === 'CRITICAL') finalSevLabel = 'Critical';
                    else if (csSev === 'HIGH') finalSevLabel = 'High';
                    else if (csSev === 'MEDIUM') finalSevLabel = 'Medium';
                }

                // De-duplicate: Keep highest
                const existing = hostCVEMap[cve];
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
                    hostCVEMap[cve] = {
                        cve: cve,
                        severity: finalSevLabel,
                        cvss: finalScore,
                        plugin_name: detail.PluginName,
                        description: detail.Description,
                        solution: detail.Solution,
                        status: a1 ? (a1.hasUpdates ? 'Patch Available' : 'No Patch Available') : "Not Recognized"
                    };
                }
            }
        }

        // Finalize lists and counts from de-duplicated data
        for (let ep in endpointUniqueCVEs) {
            endpointSeverityCounts[ep] = { Critical: 0, High: 0, Medium: 0, Low: 0 };
            const hostCVEMap = endpointUniqueCVEs[ep];
            for (let cveId in hostCVEMap) {
                const cveData = hostCVEMap[cveId];
                
                const s = cveData.severity;
                if (s === 'Critical') endpointSeverityCounts[ep].Critical++;
                else if (s === 'High') endpointSeverityCounts[ep].High++;
                else if (s === 'Medium') endpointSeverityCounts[ep].Medium++;
                else if (s === 'Low') endpointSeverityCounts[ep].Low++;

                finalCVEList.push({
                    integration_id: 'crowdstrike',
                    endpoint_name: ep,
                    cve: cveId,
                    severity: s,
                    plugin_name: cveData.plugin_name,
                    description: cveData.description,
                    solution: cveData.solution,
                    status: cveData.status
                });
            }
        }

        // 7. Reconcile Assets
        await updateProgress("Reconciling asset coverage...");
        let endpointsToSave = [];
        let csHosts = new Set(allVulns.map(v => v.host_info.hostname.trim().split('.')[0].toLowerCase()));

        // Loop Action1
        for (let name in a1eps) {
            const d = a1eps[name];
            const sevs = endpointSeverityCounts[name] || {Critical:0, High:0, Medium:0, Low:0};
            endpointsToSave.push({
                integration_id: 'crowdstrike',
                name: name,
                ipv4: d.ipv4,
                mac: d.mac,
                os: d.os,
                action1_id: d.id,
                has_agent: csHosts.has(name),
                missing_from_vm: !csHosts.has(name),
                missing_from_action1: false,
                critical: sevs.Critical,
                high: sevs.High,
                medium: sevs.Medium,
                low: sevs.Low
            });
        }
        // Loop CrowdStrike (find ones NOT in Action1)
        for (let name of csHosts) {
            if (!a1eps[name]) {
                const sevs = endpointSeverityCounts[name] || {Critical:0, High:0, Medium:0, Low:0};
                // Fallback details from first vuln found for this host
                const sample = allVulns.find(v => v.host_info.hostname.trim().split('.')[0].toLowerCase() === name);
                endpointsToSave.push({
                    integration_id: 'crowdstrike',
                    name: name,
                    ipv4: null, mac: null, os: sample?.host_info?.os_version || "Unknown",
                    action1_id: null,
                    has_agent: true,
                    missing_from_vm: false,
                    missing_from_action1: true,
                    critical: sevs.Critical, high: sevs.High, medium: sevs.Medium, low: sevs.Low
                });
            }
        }

        // 8. Save to DB
        await updateProgress(`Saving ${endpointsToSave.length} endpoints and ${finalCVEList.length} CVE mappings...`);
        const epIdsForSync = endpointsToSave.filter(e => e.action1_id).map(e => e.action1_id);
        const authoritativeCounts = {};
        
        if (epIdsForSync.length > 0) {
            await updateProgress(`Fetching authoritative Action1 patch counts for ${epIdsForSync.length} endpoints...`);
            const batchSize = 10;
            for (let i = 0; i < epIdsForSync.length; i += batchSize) {
                const batch = epIdsForSync.slice(i, i + batchSize);
                await Promise.all(batch.map(async (id) => {
                    try {
                        const vRes = await axios.get(`${a1Base}/Vulnerabilities/${Action1OrgID}?endpoint_id=${id}&limit=0`, { headers: a1Headers });
                        authoritativeCounts[id] = vRes.data.total_items || 0;
                    } catch (e) { authoritativeCounts[id] = null; }
                }));
            }
        }

        await new Promise((resolveDb, rejectDb) => {
            db.serialize(() => {
                db.run('BEGIN TRANSACTION');

                const stmtEp = db.prepare(
                    `INSERT INTO endpoints (integration_id, run_id, endpoint_name, ipv4, mac, os, action1_id, tenable_has_agent, missing_from_tenable, missing_from_action1, critical_vulns, high_vulns, medium_vulns, low_vulns, patchable_vulns)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                );
                for (let ep of endpointsToSave) {
                    let finalPatchCount = (ep.action1_id && authoritativeCounts[ep.action1_id] != null)
                        ? authoritativeCounts[ep.action1_id] : 0;
                    stmtEp.run(ep.integration_id, runId, ep.name, ep.ipv4, ep.mac, ep.os, ep.action1_id, ep.has_agent, ep.missing_from_vm, ep.missing_from_action1, ep.critical, ep.high, ep.medium, ep.low, finalPatchCount);
                }
                stmtEp.finalize();

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
                const stmtCve = db.prepare(
                    `INSERT INTO endpoint_cves (integration_id, run_id, endpoint_name, cve, severity, status)
                     VALUES (?, ?, ?, ?, ?, ?)`
                );
                for (let cve of finalCVEList) {
                    stmtCve.run(cve.integration_id, runId, cve.endpoint_name, cve.cve, cve.severity, cve.status);
                }
                stmtCve.finalize();

                db.run('COMMIT', (err) => {
                    if (err) rejectDb(err); else resolveDb();
                });
            });
        });

        // Cleanup: Keep only the current run
        db.run(`DELETE FROM endpoints WHERE integration_id = 'crowdstrike' AND run_id != ?`, [runId]);
        db.run(`DELETE FROM endpoint_cves WHERE integration_id = 'crowdstrike' AND run_id != ?`, [runId]);

        await computeAndSaveRunMetrics(runId, 'crowdstrike');

        await updateProgress("Sync complete.");
        await new Promise(res => {
            db.run('UPDATE sync_history SET status = ?, details = ?, assets_processed = ? WHERE id = ?',
                ['Success', fullLogStr, endpointsToSave.length, runId], res);
        });
        db.run('UPDATE integrations SET last_sync = CURRENT_TIMESTAMP WHERE id = ?', ['crowdstrike']);

    } catch (err) {
        await updateProgress(`Sync Engine Error: ${err.message}`);
        await new Promise(res => {
            db.run('UPDATE sync_history SET status = ?, details = ? WHERE id = ?',
                ['Failed', fullLogStr, runId], res);
        });
    }
}

module.exports = { runSync };
