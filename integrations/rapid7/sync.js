let axios;
let db;
let getSetting;
let getAction1Credentials;
let computeAndSaveRunMetrics;
let nvdService;
const { discoverAction1Inventory } = require('./action1Organizations');
const DEFAULT_ACTION1_BASE_URL = 'https://app.action1.com/api/3.0';

function action1BaseUrl(credentials = {}) {
    return String(credentials.baseUrl || DEFAULT_ACTION1_BASE_URL).replace(/\/+$/, '');
}

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

function extractRapid7Os(asset = {}) {
    const os = asset.os || asset.operating_system || asset.operatingSystem || asset.os_name || asset.osName || {};
    return firstString(
        asset.os,
        asset.operating_system,
        asset.operatingSystem,
        asset.os_name,
        asset.osName,
        asset.platform,
        asset.family,
        os.description,
        os.name,
        os.family,
        os.product,
        asset.system?.os,
        asset.system?.operating_system,
        asset.system?.operatingSystem,
        asset.host?.os,
        asset.host?.operating_system,
        asset.host?.operatingSystem
    );
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
    console.log("Starting Rapid7 Sync Engine...");

    // Create new Run ID
    const runId = await new Promise((resolve, reject) => {
        db.run('INSERT INTO sync_history (integration_id, status, details) VALUES (?, ?, ?)', ['rapid7', 'Running', 'Started sync'], function(err) {
            if (err) reject(err);
            else resolve(this.lastID);
        });
    });

    let fullLogStr = "Started sync\n";
    const updateProgress = async (msg) => {
        console.log(`[Rapid7] ${msg}`);
        fullLogStr += `${new Date().toISOString().substring(11,19)} - ${msg}\n`;
        await new Promise((resolve) => {
            db.run('UPDATE sync_history SET details = ? WHERE id = ?', [fullLogStr, runId], resolve);
        });
    };

    try {
        const Rapid7ApiKey = await getSetting('Rapid7ApiKey');
        const Rapid7Region = await getSetting('Rapid7Region');
        const Rapid7BaseUrl = `https://${Rapid7Region}.api.insight.rapid7.com/vm/v4`;

        const action1Credentials = await getAction1Credentials();
        const { apiKey: action1ApiKey, apiSecret: action1ApiSecret } = action1Credentials;

        if (!Rapid7ApiKey || !Rapid7Region) {
            throw new Error('Rapid7 API key or region is not configured in integration settings.');
        }
        if (!action1ApiKey || !action1ApiSecret) {
            throw new Error('Action1 credentials are not configured. Configure and validate Action1 in Marketplace Settings.');
        }

        const r7Headers = {
            'X-Api-Key': Rapid7ApiKey,
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        };

        const a1Base = action1BaseUrl(action1Credentials);

        // 1. Authenticate with Action1
        await updateProgress("Authenticating with Action1...");
        let a1Token = null;
        try {
            const tokenParams = new URLSearchParams();
            tokenParams.append('client_id', action1ApiKey);
            tokenParams.append('client_secret', action1ApiSecret);
            const tokenRes = await axios.post(`${a1Base}/oauth2/token`, tokenParams, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });
            a1Token = tokenRes.data.access_token;
        } catch (e) {
            throw new Error(`Action1 authentication failed: ${e.message}`);
        }
        const a1Headers = { 'Authorization': `Bearer ${a1Token}`, 'Accept': 'application/json' };

        // 2. Fetch Action1 Endpoints
        await updateProgress("Retrieving Action1 endpoints...");
        const { organizations: action1Organizations, endpoints: action1Assets } =
            await discoverAction1Inventory(axios, a1Base, a1Headers);

        let a1eps = {};
        const action1Names = new Set();
        for (let ep of action1Assets) {
            const name = ep.match_name;
            action1Names.add(name);
            a1eps[`${ep.action1_organization_id}::${name}`] = {
                id: ep.id, match_name: name, device_name: ep.device_name, ipv4: ep.address, os: ep.OS, mac: ep.Mac,
                action1_organization_id: ep.action1_organization_id,
                action1_organization_name: ep.action1_organization_name
            };
        }
        await updateProgress(`Retrieved ${Object.keys(a1eps).length} Action1 endpoints across ${action1Organizations.length} organizations.`);

        // 3. Fetch Rapid7 Assets (InsightVM)
        await updateProgress("Fetching Rapid7 assets...");
        let allR7Assets = [];
        let r7Page = 0;
        let r7TotalPages = 1;

        do {
            const uri = `${Rapid7BaseUrl}/integration/assets?page=${r7Page}&size=500`;
            const resp = await axios.post(uri, {}, { headers: r7Headers });
            if (resp.data.data) {
                allR7Assets = allR7Assets.concat(resp.data.data);
                await updateProgress(`Retrieved Rapid7 assets page ${r7Page}...`);
            }
            r7TotalPages = resp.data.metadata?.totalPages || resp.data.metadata?.total_pages || 0;
            r7Page++;
            if (r7Page > 50) break; // Safety
        } while (r7Page < r7TotalPages);

        await updateProgress(`Found ${allR7Assets.length} total Rapid7 assets.`);

        // 4. Fetch Vulnerabilities per Asset
        await updateProgress("Retrieving detailed vulnerability mappings per asset...");
        let eps = {}; // map of endpoint to cve list
        let uniqueVulnIds = new Set();
        const rapid7AssetDetailsByName = {};

        for (let asset of allR7Assets) {
            if (!asset.host_name || !asset.id) continue;
            let name = asset.host_name.trim().split('.')[0].toLowerCase();
            rapid7AssetDetailsByName[name] = {
                os: extractRapid7Os(asset)
            };

            try {
                const detailRes = await axios.get(`${Rapid7BaseUrl}/integration/assets/${asset.id}?includeSame=true`, { headers: r7Headers });
                const detailAsset = detailRes.data || {};
                rapid7AssetDetailsByName[name] = {
                    ...rapid7AssetDetailsByName[name],
                    os: extractRapid7Os(detailAsset) || rapid7AssetDetailsByName[name]?.os
                };
                const vulns = detailRes.data.same || [];
                if (vulns.length > 0) {
                    if (!eps[name]) eps[name] = new Set();
                    vulns.forEach(v => {
                        eps[name].add(v.vulnerability_id);
                        uniqueVulnIds.add(v.vulnerability_id);
                    });
                }
            } catch (e) {
                console.error(`Failed to get vulns for asset ${asset.host_name}:`, e.message);
            }
        }

        // 5. Fetch Vulnerability Details (CVEs, Severities)
        await updateProgress(`Lookup details for ${uniqueVulnIds.size} unique Rapid7 vulnerability IDs...`);
        let vulnLookupMap = {};
        const vulnIdArray = Array.from(uniqueVulnIds);

        // We can't batch lookup easily in v4 with IDs, the script does it one by one in a loop.
        // I'll try to do it in chunks if possible, but the API might be limited.
        // Let's do it like the script: POST /integration/vulnerabilities with id filter.
        for (let vId of vulnIdArray) {
            try {
                const searchRes = await axios.post(`${Rapid7BaseUrl}/integration/vulnerabilities?size=1`, {
                    vulnerability: `id = '${vId}'`
                }, { headers: r7Headers });

                const vData = searchRes.data.data?.[0] || searchRes.data.data || searchRes.data;
                if (vData) {
                    vulnLookupMap[vId] = {
                        cves: vData.cves || [],
                        severity: vData.severity || "Unknown",
                        title: vData.title || `Rapid7 Vuln ${vId}`,
                        description: vData.description || "",
                        solution: vData.remediation || "Refer to InsightVM."
                    };
                }
            } catch (e) {
                console.error(`Failed lookup for vuln ${vId}:`, e.message);
            }
        }

        // 6. Fetch Action1 Vulnerability Catalog (Paginated)
        await updateProgress("Fetching Action1 vulnerability catalog...");
        let action1Vulns = {};
        try {
            const limit = 5000;
            let totalFetched = 0;
            for (const organization of action1Organizations) {
              let offset = 0;
              let organizationFetched = 0;
              let hasMore = true;
              while (hasMore) {
                const catRes = await axios.get(`${a1Base}/Vulnerabilities/${organization.id}?limit=${limit}&from=${offset}`, { headers: a1Headers });
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
                    organizationFetched += catData.length;
                    offset += limit;
                    if (organizationFetched >= (p.total_items || 50000)) hasMore = false;
                    if (offset > 100000) hasMore = false;
                }
              }
            }
            await updateProgress(`Action1 catalog loaded: ${totalFetched} vulnerabilities.`);
        } catch (e) {
            await updateProgress(`Failed fetching Action1 vuln catalog: ${e.response?.status || e.message}`);
        }

        // 7. Map Everything for DB (with de-duplication and NIST arbitration)
        await updateProgress("Fetching NIST CVSS scores for all unique CVEs to guarantee strict accuracy...");
        const allDiscoveredCVEs = new Set();
        for (let vId in eps) {
            const vIds = Array.from(eps[vId]);
            for (let id of vIds) {
                const detail = vulnLookupMap[id];
                if (detail) {
                    const cveList = Array.isArray(detail.cves) ? detail.cves : (detail.cves ? detail.cves.split(',') : []);
                    cveList.forEach(c => c.trim() && allDiscoveredCVEs.add(c.trim()));
                }
            }
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

        await updateProgress("Reconciling and preparing database records with NIST arbitration...");
        let finalCVEList = [];
        let endpointSeverityCounts = {};
        let r7HostsSeen = new Set(allR7Assets.map(a => a.host_name.trim().split('.')[0].toLowerCase()));

        let endpointUniqueCVEs = {}; // name -> { cveId -> { cve, severity, cvss, status, ... } }

        for (let name in eps) {
            if (!endpointUniqueCVEs[name]) endpointUniqueCVEs[name] = {};
            const hostCVEMap = endpointUniqueCVEs[name];

            const vIds = Array.from(eps[name]);
            for (let vId of vIds) {
                const detail = vulnLookupMap[vId];
                if (!detail) continue;

                const cveList = Array.isArray(detail.cves) ? detail.cves : (detail.cves ? detail.cves.split(',') : []);
                for (let cve of cveList) {
                    const cleanCVE = cve.trim();
                    if (!cleanCVE) continue;

                    // Ground Truth Arbitration:
                    const nist = await nvdService.getFromCache(cleanCVE);
                    const a1 = action1Vulns[cleanCVE];

                    let finalSevLabel = 'Low';
                    let finalScore = null;

                    if (nist) {
                        finalSevLabel = nist.severity;
                        finalScore = nist.score;
                    } else if (a1 && a1.score !== null) {
                        finalSevLabel = a1.severity || 'Low';
                        finalScore = a1.score;
                    } else {
                        // Rapid7 fallback
                        finalSevLabel = 'Low';
                        const r7Sev = (detail.severity || "Unknown").toUpperCase();
                        if (r7Sev === 'CRITICAL' || r7Sev === 'SEVERE') finalSevLabel = 'Critical';
                        else if (r7Sev === 'HIGH') finalSevLabel = 'High';
                        else if (r7Sev === 'MEDIUM' || r7Sev === 'MODERATE') finalSevLabel = 'Medium';
                    }

                    if (finalScore !== null) {
                        await nvdService.saveToCache(cleanCVE, finalScore, finalSevLabel);
                    }

                    // De-duplicate: Keep highest
                    const existing = hostCVEMap[cleanCVE];
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
                        hostCVEMap[cleanCVE] = {
                            cve: cleanCVE,
                            severity: finalSevLabel,
                            cvss: finalScore,
                            plugin_name: detail.title,
                            description: detail.description,
                            solution: detail.solution,
                            status: a1 ? (a1.remediationStatus || 'Non Patchable') : "Non Patchable",
                            hasAction1Match: !!a1,
                            patchable: !!a1?.hasUpdates
                        };
                    }
                }
            }
        }

        // Finalize lists and counts from de-duplicated data
        for (let name in endpointUniqueCVEs) {
            const endpointHasAction1 = action1Names.has(name);
            endpointSeverityCounts[name] = { Critical: 0, High: 0, Medium: 0, Low: 0, Patchable: 0 };
            const hostCVEMap = endpointUniqueCVEs[name];
            for (let cveId in hostCVEMap) {
                const cveData = hostCVEMap[cveId];
                const remediationStatus = endpointHasAction1 && cveData.patchable ? 'Patch Available' : 'Non Patchable';

                const s = cveData.severity;
                if (s === 'Critical') endpointSeverityCounts[name].Critical++;
                else if (s === 'High') endpointSeverityCounts[name].High++;
                else if (s === 'Medium') endpointSeverityCounts[name].Medium++;
                else if (s === 'Low') endpointSeverityCounts[name].Low++;

                if (remediationStatus === 'Patch Available') {
                    endpointSeverityCounts[name].Patchable++;
                }

                finalCVEList.push({
                    integration_id: 'rapid7',
                    endpoint_name: name,
                    cve: cveId,
                    severity: s,
                    status: remediationStatus,
                    source: cveData.hasAction1Match ? 'Both' : 'VM Scanner',
                    plugin_name: cveData.plugin_name,
                    description: cveData.description,
                    solution: cveData.solution
                });
            }
        }

        let endpointsToSave = [];
        // Reconcile Action1
        for (let key in a1eps) {
            const d = a1eps[key];
            const name = d.match_name;
            const sevs = endpointSeverityCounts[name] || {Critical:0, High:0, Medium:0, Low:0, Patchable:0};
            endpointsToSave.push({
                integration_id: 'rapid7', run_id: runId, endpoint_name: name,
                ipv4: d.ipv4, mac: d.mac, os: d.os, action1_id: d.id,
                action1_organization_id: d.action1_organization_id,
                action1_organization_name: d.action1_organization_name,
                has_agent: r7HostsSeen.has(name),
                missing_from_vm: !r7HostsSeen.has(name),
                missing_from_action1: false,
                critical: sevs.Critical, high: sevs.High, medium: sevs.Medium, low: sevs.Low, patchable: sevs.Patchable
            });
        }
        // Reconcile Rapid7
        for (let name of r7HostsSeen) {
            if (!action1Names.has(name)) {
                const sevs = endpointSeverityCounts[name] || {Critical:0, High:0, Medium:0, Low:0, Patchable:0};
                const assetData = allR7Assets.find(a => a.host_name.trim().split('.')[0].toLowerCase() === name);
                endpointsToSave.push({
                    integration_id: 'rapid7', run_id: runId, endpoint_name: name,
                    ipv4: null, mac: null, os: rapid7AssetDetailsByName[name]?.os || extractRapid7Os(assetData) || "Unknown",
                    action1_id: null,
                    has_agent: true,
                    missing_from_vm: false,
                    missing_from_action1: true,
                    critical: sevs.Critical, high: sevs.High, medium: sevs.Medium, low: sevs.Low, patchable: sevs.Patchable
                });
            }
        }

        const action1EndpointCounts = {};
        const action1Endpoints = endpointsToSave.filter(e => e.action1_id);

        if (action1Endpoints.length > 0) {
            await updateProgress(`Fetching authoritative Action1 vulnerability counts for ${action1Endpoints.length} endpoints...`);
            const batchSize = 10;
            let action1EndpointFetchFailures = 0;
            for (let i = 0; i < action1Endpoints.length; i += batchSize) {
                const batch = action1Endpoints.slice(i, i + batchSize);
                await Promise.all(batch.map(async (endpoint) => {
                    const key = `${endpoint.action1_organization_id}::${endpoint.action1_id}`;
                    try {
                        action1EndpointCounts[key] = await fetchAction1EndpointVulnCounts(a1Base, endpoint.action1_organization_id, endpoint.action1_id, a1Headers);
                    } catch (e) {
                        action1EndpointFetchFailures++;
                        action1EndpointCounts[key] = null;
                        await updateProgress(`Failed fetching Action1 endpoint vulnerability counts for ${endpoint.endpoint_name}: ${e.response?.status || e.message}`);
                    }
                }));
            }
            const action1EndpointFetchSuccesses = Object.values(action1EndpointCounts).filter(Boolean).length;
            const action1EndpointCveTotal = Object.values(action1EndpointCounts)
                .filter(Boolean)
                .reduce((total, counts) => total + (counts.total || 0), 0);
            await updateProgress(`Loaded Action1 endpoint vulnerability counts for ${action1EndpointFetchSuccesses}/${action1Endpoints.length} endpoints (${action1EndpointCveTotal} CVEs, ${action1EndpointFetchFailures} failures).`);
        }

        finalCVEList = [];
        for (const ep of endpointsToSave) {
            const rapid7Cves = ep.missing_from_vm ? {} : (endpointUniqueCVEs[ep.endpoint_name] || {});
            const action1Counts = ep.action1_id ? action1EndpointCounts[`${ep.action1_organization_id}::${ep.action1_id}`] : null;
            const action1Cves = action1Counts?.cves || {};
            const cveIds = Array.from(new Set([...Object.keys(rapid7Cves), ...Object.keys(action1Cves)]));

            for (const cveId of cveIds) {
                const rapid7Cve = rapid7Cves[cveId];
                const action1Cve = action1Cves[cveId];
                const cveData = rapid7Cve && action1Cve
                    ? chooseCveEntry(rapid7Cve, action1Cve)
                    : (rapid7Cve || action1Cve);
                const source = rapid7Cve && action1Cve ? 'Both' : action1Cve ? 'Action1' : 'VM Scanner';
                const status = ep.action1_id && action1Cve?.patchable
                    ? 'Patch Available'
                    : 'Non Patchable';
                finalCVEList.push({
                    integration_id: 'rapid7',
                    endpoint_name: ep.endpoint_name,
                    action1_organization_id: ep.action1_organization_id || null,
                    cve: cveData.cve || cveId,
                    severity: normalizeSeverityLabel(cveData.severity, cveData.cvss),
                    status,
                    source,
                    plugin_name: cveData.plugin_name || cveData.title || cveData.cve || cveId,
                    description: cveData.description || '',
                    solution: cveData.solution || ''
                });
            }
        }

        // 8. Save to DB
        await updateProgress(`Saving data for ${endpointsToSave.length} total machines...`);

        await new Promise((resolveDb, rejectDb) => {
            db.serialize(() => {
                db.run('BEGIN TRANSACTION');

                for (let ep of endpointsToSave) {
                    const rapid7Cves = ep.missing_from_vm ? {} : (endpointUniqueCVEs[ep.endpoint_name] || {});
                    const action1Counts = ep.action1_id ? action1EndpointCounts[`${ep.action1_organization_id}::${ep.action1_id}`] : null;
                    const rapid7Counts = countBySeverity(rapid7Cves);
                    const mergedCounts = countBySeverity(mergeCveMaps(rapid7Cves, action1Counts?.cves || {}));
                    const rapid7PatchableCount = Object.values(rapid7Cves).filter((cve) => cve.patchable).length;

                    db.run(`INSERT INTO rapid7_endpoints (integration_id, run_id, endpoint_name, ipv4, mac, os, action1_id, action1_organization_id, action1_organization_name, tenable_has_agent, missing_from_tenable, missing_from_action1, defender_total_vulns, critical_vulns, high_vulns, medium_vulns, low_vulns, action1_critical_vulns, action1_high_vulns, action1_medium_vulns, action1_low_vulns, patchable_vulns)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            ep.integration_id, runId, ep.endpoint_name, ep.ipv4, ep.mac, ep.os, ep.action1_id,
                            ep.action1_organization_id || null, ep.action1_organization_name || null,
                            ep.has_agent, ep.missing_from_vm, ep.missing_from_action1,
                            rapid7Counts.total,
                            mergedCounts.Critical || 0,
                            mergedCounts.High || 0,
                            mergedCounts.Medium || 0,
                            mergedCounts.Low || 0,
                            action1Counts?.Critical || 0,
                            action1Counts?.High || 0,
                            action1Counts?.Medium || 0,
                            action1Counts?.Low || 0,
                            action1Counts?.patchableTotal ?? rapid7PatchableCount
                        ]
                    );
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
                const stmtCve = db.prepare(
                    `INSERT INTO rapid7_endpoint_cves (integration_id, run_id, endpoint_name, action1_organization_id, cve, severity, status, source)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
                );
                for (let cve of finalCVEList) {
                    stmtCve.run('rapid7', runId, cve.endpoint_name, cve.action1_organization_id, cve.cve, cve.severity, cve.status, cve.source);
                }
                stmtCve.finalize();

                db.run('COMMIT', (err) => {
                    if (err) rejectDb(err); else resolveDb();
                });
            });
        });

        // Cleanup: Keep only the current run
        db.run(`DELETE FROM rapid7_endpoints WHERE run_id != ?`, [runId]);
        db.run(`DELETE FROM rapid7_endpoint_cves WHERE run_id != ?`, [runId]);

        await computeAndSaveRunMetrics(runId, 'rapid7');

        await updateProgress("Sync complete.");
        await new Promise(res => {
            db.run('UPDATE sync_history SET status = ?, details = ?, assets_processed = ? WHERE id = ?',
                ['Success', fullLogStr, endpointsToSave.length, runId], res);
        });
        db.run('UPDATE integrations SET last_sync = CURRENT_TIMESTAMP WHERE id = ?', ['rapid7']);

    } catch (err) {
        await updateProgress(`Sync Engine Error: ${err.message}`);
        await new Promise(res => {
            db.run('UPDATE sync_history SET status = ?, details = ? WHERE id = ?',
                ['Failed', fullLogStr, runId], res);
        });
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
