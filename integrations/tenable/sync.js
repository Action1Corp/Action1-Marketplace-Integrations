// Wait utility
const delay = ms => new Promise(res => setTimeout(res, ms));

function firstString(...values) {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) return value.trim();
        if (Array.isArray(value)) {
            const match = value.find(item => typeof item === 'string' && item.trim());
            if (match) return match.trim();
        }
    }
    return null;
}

function extractTenableOs(asset = {}) {
    return firstString(
        asset.operating_system,
        asset.operatingSystem,
        asset.os,
        asset.system?.operating_system,
        asset.system?.operatingSystem,
        asset.system?.os
    );
}

async function sync(context) {
    const axios = context.http;
    const db = context.db.raw;
    const getSetting = context.settings.get;
    const getAction1Credentials = context.action1.getCredentials;
    const nvdService = context.services.nvd;
    const computeAndSaveRunMetrics = context.services.computeAndSaveRunMetrics;
    context.logger.info("Starting Tenable Sync Engine...");

    // Create new Run ID
    const runId = await new Promise((resolve, reject) => {
        db.run('INSERT INTO sync_history (status, details) VALUES (?, ?)', ['Running', 'Started sync'], function(err) {
            if (err) reject(err);
            else resolve(this.lastID);
        });
    });

    let fullLogStr = "Started sync\n";
    const updateProgress = async (msg) => {
        console.log(msg);
        fullLogStr += `${new Date().toISOString().substring(11,19)} - ${msg}\n`;
        await new Promise((resolve) => {
            db.run('UPDATE sync_history SET details = ? WHERE id = ?', [fullLogStr, runId], resolve);
        });
    };

    try {
        const TenableAccessKey = await getSetting('TenableAccessKey');
        const TenableSecretKey = await getSetting('TenableSecretKey');
        const { apiKey: action1ApiKey, apiSecret: action1ApiSecret, organizationId: action1OrgId } = await getAction1Credentials();

        if (!TenableAccessKey || !action1ApiKey || !action1OrgId) {
            throw new Error('API keys are not fully configured in settings.');
        }

        const tenableHeaders = {
            "X-ApiKeys": `accessKey=${TenableAccessKey}; secretKey=${TenableSecretKey}`,
            "Accept": "application/json",
            "Content-Type": "application/json"
        };
        const tenableApiBase = "https://cloud.tenable.com";

        const a1Base = "https://app.action1.com/api/3.0";

        await updateProgress("Authenticating with Action1...");
        let a1Token = null;
        try {
            const tokenParams = new URLSearchParams();
            tokenParams.append('client_id', action1ApiKey);
            tokenParams.append('client_secret', action1ApiSecret);
            const tokenRes = await axios.post('https://app.action1.com/api/3.0/oauth2/token', tokenParams, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });
            a1Token = tokenRes.data.access_token;
        } catch (e) {
            throw new Error(`Action1 authentication failed: ${e.message}`);
        }

        const a1Headers = { 'Authorization': `Bearer ${a1Token}`, 'Accept': 'application/json' };

        // -------------------------------------------------------------
        // 1. Fetch Action1 Endpoints
        // -------------------------------------------------------------
        await updateProgress("Retrieving Action1 endpoints...");
        let action1Assets = [];
        try {
            const a1Res = await axios.get(`${a1Base}/endpoints/managed/${action1OrgId}?limit=9999`, { headers: a1Headers });
            const payload = a1Res.data;
            if (Array.isArray(payload)) action1Assets = payload;
            else if (Array.isArray(payload.items)) action1Assets = payload.items;
            else if (Array.isArray(payload.data)) action1Assets = payload.data;
            else if (Array.isArray(payload.endpoints)) action1Assets = payload.endpoints;
            else {
                await updateProgress(`Unrecognized Action1 endpoint structure: ${Object.keys(payload)}`);
            }
        } catch (e) {
            await updateProgress(`Failed fetching Action1 endpoints. Response code: ${e.response?.status} ${e.message}`);
        }

        await updateProgress(`Retrieved ${action1Assets.length} Action1 endpoints.`); // Lookup
        let a1eps = {}; // Lookup
        for (let ep of action1Assets) {
            if (!ep.device_name) continue;
            let name = ep.device_name.trim().split('.')[0].toLowerCase();
            a1eps[name] = {
                id: ep.id,
                device_name: ep.device_name,
                ipv4: ep.address,
                os: ep.OS,
                mac: ep.Mac
            };
        }


        // -------------------------------------------------------------
        // 2. Fetch Tenable Vulnerabilities
        // -------------------------------------------------------------
        await updateProgress("Creating Tenable vuln export job...");
        const vulnBody = {
            num_assets: 5000,
            include_unlicensed: false,
            filters: { severity: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] }
        };
        const vulnExportRes = await axios.post(`${tenableApiBase}/vulns/export`, vulnBody, { headers: tenableHeaders });
        const vulnExportUuid = vulnExportRes.data.export_uuid;

        const pollExport = async (type, uuid) => {
            let elapsed = 0;
            const pollInterval = 15000; // 15 seconds
            while (true) {
                await delay(pollInterval);
                elapsed += 15;
                const statusRes = await axios.get(`${tenableApiBase}/${type}/export/${uuid}/status`, { headers: tenableHeaders });
                const status = statusRes.data;
                if (status.status === "FINISHED" || (status.chunks_available && status.chunks_available.length > 0)) {
                    return status.chunks_available || [];
                }
                if (elapsed >= 1800) { // 30 mins
                    throw new Error(`Timeout waiting for Tenable ${type} export.`);
                }
            }
        };

        let vulnChunks = await pollExport("vulns", vulnExportUuid);
        let allVulns = [];
        for (let chunk of vulnChunks) {
            await updateProgress(`Downloading Vuln chunk ${chunk}...`);
            const chunkRes = await axios.get(`${tenableApiBase}/vulns/export/${vulnExportUuid}/chunks/${chunk}`, { headers: tenableHeaders });
            if (Array.isArray(chunkRes.data)) {
                allVulns = allVulns.concat(chunkRes.data);
            }
        }

        let eps = {}; // map of endpoint to cve list
        let cveDetails = {};
        for (let v of allVulns) {
            let host = v.asset?.netbios_name;
            if (!host) continue;
            let epName = host.trim().split('.')[0].toLowerCase();

            let cveList = v.plugin?.cve;
            if (cveList && Array.isArray(cveList)) {
                if (!eps[epName]) eps[epName] = [];
                for (let cve of cveList) {
                    eps[epName].push(cve);
                    cveDetails[cve] = {
                        Description: v.plugin?.description || "",
                        Solution: v.plugin?.solution || "",
                        Severity: v.severity || "Unknown",
                        PluginName: v.plugin?.name || ""
                    };
                }
            }
        }

        // -------------------------------------------------------------
        // 3. Fetch Action1 Vulnerability Catalog (Paginated)
        // -------------------------------------------------------------
        await updateProgress("Fetching Action1 vulnerability catalog...");
        let action1Vulns = {};
        try {
            let offset = 0;
            const limit = 5000;
            let totalFetched = 0;
            let hasMore = true;

            while (hasMore) {
                const catRes = await axios.get(`${a1Base}/Vulnerabilities/${action1OrgId}?limit=${limit}&from=${offset}`, { headers: a1Headers });
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
                        const remediationStatus = hasUpdates ? 'Patch Available' : 'Non Patchable';
                        action1Vulns[v.cve_id] = { hasUpdates, remediationStatus, score: isNaN(score) ? null : score, severity: v.severity };
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

        // -------------------------------------------------------------
        // 4. Determine CVE Status per Endpoint (with NIST arbitration)
        // -------------------------------------------------------------
        await updateProgress("Fetching NIST CVSS scores for all unique CVEs to guarantee strict accuracy...");
        const allDiscoveredCVEs = new Set();
        for (let ep in eps) {
            eps[ep].forEach(cve => cve && cve.trim() && allDiscoveredCVEs.add(cve.trim()));
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

        await updateProgress("Mapping CVEs to Endpoints with NIST arbitration...");
        let endpointSeverityCounts = {};
        let finalCVEList = [];

        let endpointUniqueCVEs = {}; // ep -> { cveId -> { cve, severity, cvss, status, ... } }

        for (let ep in eps) {
            if (!endpointUniqueCVEs[ep]) endpointUniqueCVEs[ep] = {};
            const hostCVEMap = endpointUniqueCVEs[ep];

            let uniqueCvesRaw = [...new Set(eps[ep])];
            for (let cveId of uniqueCvesRaw) {
                // Ground Truth Arbitration:
                const nist = await nvdService.getFromCache(cveId);
                const a1 = action1Vulns[cveId];
                const detail = cveDetails[cveId];

                let finalSevLabel = 'Low';
                let finalScore = null;

                if (nist) {
                    finalSevLabel = nist.severity;
                    finalScore = nist.score;
                } else if (a1 && a1.score !== null) {
                    finalSevLabel = a1.severity || 'Low';
                    finalScore = a1.score;
                } else {
                    // Tenable fallback
                    finalSevLabel = 'Low';
                    let tSev = (detail?.Severity || "Unknown").toUpperCase();
                    if (tSev === 'CRITICAL') finalSevLabel = 'Critical';
                    else if (tSev === 'HIGH') finalSevLabel = 'High';
                    else if (tSev === 'MEDIUM') finalSevLabel = 'Medium';
                }

                if (finalScore !== null) {
                    await nvdService.saveToCache(cveId, finalScore, finalSevLabel);
                }

                // De-duplicate: Keep highest
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
                        plugin_name: detail?.PluginName || "",
                        description: detail?.Description || "",
                        solution: detail?.Solution || "",
                        status: a1 ? (a1.remediationStatus || 'Non Patchable') : "Non Patchable",
                        patchable: !!a1?.hasUpdates
                    };
                }
            }
        }

        // Finalize lists and counts from de-duplicated data
        for (let ep in endpointUniqueCVEs) {
            const endpointHasAction1 = !!a1eps[ep];
            endpointSeverityCounts[ep] = { Critical: 0, High: 0, Medium: 0, Low: 0, Patchable: 0 };
            const hostCVEMap = endpointUniqueCVEs[ep];
            for (let cveId in hostCVEMap) {
                const cveData = hostCVEMap[cveId];
                const remediationStatus = endpointHasAction1 && cveData.patchable ? 'Patch Available' : 'Non Patchable';

                const s = cveData.severity;
                if (s === 'Critical') endpointSeverityCounts[ep].Critical++;
                else if (s === 'High') endpointSeverityCounts[ep].High++;
                else if (s === 'Medium') endpointSeverityCounts[ep].Medium++;
                else if (s === 'Low') endpointSeverityCounts[ep].Low++;

                if (remediationStatus === 'Patch Available') {
                    endpointSeverityCounts[ep].Patchable++;
                }

                finalCVEList.push({
                    endpoint_name: ep,
                    cve: cveId,
                    severity: s,
                    plugin_name: cveData.plugin_name,
                    description: cveData.description,
                    solution: cveData.solution,
                    status: remediationStatus
                });
            }
        }

        // -------------------------------------------------------------
        // 5. Fetch Tenable Assets
        // -------------------------------------------------------------
        await updateProgress("Requesting Tenable asset export job...");
        let tenableAssetsList = [];
        try {
            const assetExportRes = await axios.post(`${tenableApiBase}/assets/v2/export`, { chunk_size: 5000 }, { headers: tenableHeaders });
            const assetExportUuid = assetExportRes.data.export_uuid;
            let assetChunks = await pollExport("assets", assetExportUuid);

            for (let chunk of assetChunks) {
                await updateProgress(`Downloading Asset chunk ${chunk}...`);
                const chunkRes = await axios.get(`${tenableApiBase}/assets/export/${assetExportUuid}/chunks/${chunk}`, { headers: tenableHeaders });
                const arr = Array.isArray(chunkRes.data) ? chunkRes.data : [chunkRes.data];
                tenableAssetsList = tenableAssetsList.concat(arr);
            }
        } catch(e) {}

        let allTenableAssets = {};
        for (let asset of tenableAssetsList) {
            if (!asset) continue;
            let tName = null;
            let nbNames = asset.network?.netbios_names;
            let rawName = Array.isArray(nbNames) ? nbNames[0] : nbNames;
            if (rawName && typeof rawName === 'string') {
                tName = rawName.trim().split('.')[0].toLowerCase();
            }

            if (tName) {
                allTenableAssets[tName] = {
                    ipv4: asset.network?.ipv4s?.[0],
                    mac: asset.network?.mac_addresses?.[0],
                    os: extractTenableOs(asset),
                    has_agent: asset.has_agent || false
                };
            }
        }

        // -------------------------------------------------------------
        // 6. Find Missing Assets & Combine Data
        // -------------------------------------------------------------
        let endpointsToSave = [];

        // Loop Action1 Assets to find missing from Tenable
        for (let a1 in a1eps) {
            const d = a1eps[a1];
            let missingFromTenable = !allTenableAssets.hasOwnProperty(a1);

            const sevs = endpointSeverityCounts[a1] || {Critical:0,High:0,Medium:0,Low:0,Patchable:0};

            endpointsToSave.push({
                name: a1,
                ipv4: d.ipv4,
                mac: d.mac,
                os: d.os,
                action1_id: d.id,
                has_agent: allTenableAssets[a1] ? allTenableAssets[a1].has_agent : false,
                missing_from_tenable: missingFromTenable,
                missing_from_action1: false,
                critical: sevs.Critical,
                high: sevs.High,
                medium: sevs.Medium,
                low: sevs.Low,
                patchable: sevs.Patchable
            });
        }

        // Loop Tenable Assets to find missing from Action1
        for (let t in allTenableAssets) {
            if (!a1eps.hasOwnProperty(t)) {
                const tv = allTenableAssets[t];
                const sevs = endpointSeverityCounts[t] || {Critical:0,High:0,Medium:0,Low:0,Patchable:0};
                endpointsToSave.push({
                    name: t,
                    ipv4: tv.ipv4,
                    mac: tv.mac,
                    os: tv.os,
                    action1_id: null,
                    has_agent: tv.has_agent,
                    missing_from_tenable: false,
                    missing_from_action1: true,
                    critical: sevs.Critical,
                    high: sevs.High,
                    medium: sevs.Medium,
                    low: sevs.Low,
                    patchable: sevs.Patchable
                });
            }
        }

        // -------------------------------------------------------------
        // 7. Save to SQLite
        // -------------------------------------------------------------
        await updateProgress(`Saving ${endpointsToSave.length} total machines...`);

        await new Promise((resolveDb, rejectDb) => {
            db.serialize(() => {
                db.run('BEGIN TRANSACTION');
                const stmtEp = db.prepare(
                    `INSERT INTO tenable_endpoints
                     (integration_id, run_id, endpoint_name, ipv4, mac, os, action1_id, tenable_has_agent, missing_from_tenable, missing_from_action1, critical_vulns, high_vulns, medium_vulns, low_vulns, patchable_vulns)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                );
                for (const ep of endpointsToSave) {
                    stmtEp.run('tenable', runId, ep.name, ep.ipv4, ep.mac, ep.os, ep.action1_id, ep.has_agent, ep.missing_from_tenable, ep.missing_from_action1, ep.critical, ep.high, ep.medium, ep.low, ep.patchable);
                }
                stmtEp.finalize();
                db.run('COMMIT', (err) => { if (err) rejectDb(err); else resolveDb(); });
            });
        });

        await updateProgress(`Saving ${finalCVEList.length} CVE mappings to SQLite...`);

        // Batch-write everything in a single transaction for maximum speed
        await new Promise((resolveDb, rejectDb) => {
            db.serialize(() => {
                db.run('BEGIN TRANSACTION');

                // 1. Upsert CVE details into the normalized lookup table
                const stmtDetails = db.prepare(
                    `INSERT OR REPLACE INTO cve_details (cve, plugin_name, description, solution)
                     VALUES (?, ?, ?, ?)`
                );
                for (const cve of finalCVEList) {
                    if (cve.plugin_name) {
                        stmtDetails.run(cve.cve, cve.plugin_name || '', null, null);
                    }
                }
                stmtDetails.finalize();

                // 2. Insert endpoint_cves rows (no text blobs)
                const stmtCve = db.prepare(
                    `INSERT INTO tenable_endpoint_cves (integration_id, run_id, endpoint_name, cve, severity, status)
                     VALUES (?, ?, ?, ?, ?, ?)`
                );
                for (const cve of finalCVEList) {
                    stmtCve.run('tenable', runId, cve.endpoint_name, cve.cve, cve.severity, cve.status);
                }
                stmtCve.finalize();

                db.run('COMMIT', (err) => {
                    if (err) rejectDb(err); else resolveDb();
                });
            });
        });

        // Cleanup: Keep only the current run
        db.run(`DELETE FROM tenable_endpoints WHERE run_id != ?`, [runId]);
        db.run(`DELETE FROM tenable_endpoint_cves WHERE run_id != ?`, [runId]);

        await computeAndSaveRunMetrics(runId, 'tenable');

        // Update run status
        await updateProgress(`Sync complete. RunID: ${runId}`);
        await new Promise((resolve) => {
            db.run('UPDATE sync_history SET status = ?, details = ?, assets_processed = ? WHERE id = ?',
                ['Success', fullLogStr, endpointsToSave.length, runId], resolve);
        });
    } catch (err) {
        await updateProgress(`Sync Engine Error: ${err.message || err}`);
        await new Promise((resolve) => {
            db.run('UPDATE sync_history SET status = ?, details = ? WHERE id = ?',
                ['Failed', fullLogStr, runId], resolve);
        });
    }
}

module.exports = {
  sync
};
