let axios;
let db;
let getSetting;
let computeAndSaveRunMetrics;
let nvdService;



// Wait utility
const delay = ms => new Promise(res => setTimeout(res, ms));

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

    return { ...countBySeverity(cves), cves };
}

async function runSync() {
    console.log("Starting Qualys Sync Engine...");
    
    // Create new Run ID
    const runId = await new Promise((resolve, reject) => {
        db.run('INSERT INTO sync_history (integration_id, status, details) VALUES (?, ?, ?)', ['qualys', 'Running', 'Started sync'], function(err) {
            if (err) reject(err);
            else resolve(this.lastID);
        });
    });

    let fullLogStr = "Started sync\n";
    const updateProgress = async (msg) => {
        console.log(`[Qualys] ${msg}`);
        fullLogStr += `${new Date().toISOString().substring(11,19)} - ${msg}\n`;
        await new Promise((resolve) => {
            db.run('UPDATE sync_history SET details = ? WHERE id = ?', [fullLogStr, runId], resolve);
        });
    };

    try {
        const QualysUsername = await getSetting('QualysUsername');
        const QualysPassword = await getSetting('QualysPassword');
        let QualysBaseUrl = await getSetting('QualysBaseUrl');
        if (!QualysBaseUrl) QualysBaseUrl = 'https://qualysapi.qg3.apps.qualys.com';
        QualysBaseUrl = QualysBaseUrl.replace(/\/$/, '');
        
        const Action1APIKey = await getSetting('Action1APIKey');
        const Action1APISecret = await getSetting('Action1APISecret');
        const Action1OrgID = await getSetting('Action1OrgID');

        if (!QualysUsername || !QualysPassword || !Action1APIKey || !Action1OrgID) {
            throw new Error('Qualys or Action1 API keys are not fully configured.');
        }

        const qualysAuth = Buffer.from(`${QualysUsername}:${QualysPassword}`).toString('base64');
        const qualysHeaders = { 
            'Authorization': `Basic ${qualysAuth}`, 
            'X-Requested-With': 'Node.js-SyncEngine',
            'Accept': 'application/json' 
        };

        const a1Base = "https://app.action1.com/api/3.0";

        // 1. Authenticate with Action1
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

        // 2. Fetch Action1 Endpoints
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

        // 3. Fetch Qualys VM Detections (CSV)
        await updateProgress("Requesting host detections from Qualys VM...");
        const detectionUri = `${QualysBaseUrl}/api/5.0/fo/asset/host/vm/detection/?action=list&status=Active,Re-Opened&output_format=CSV_NO_METADATA`;
        
        const hostRes = await axios.get(detectionUri, { headers: { ...qualysHeaders, 'Accept': 'text/csv' } });
        // Robust CSV parser capable of handling newlines inside quoted fields
        const parseRawCsv = (csvText) => {
            const rows = [];
            let currentPart = '';
            let currentRow = [];
            let inQuotes = false;

            for (let i = 0; i < csvText.length; i++) {
                const char = csvText[i];
                if (char === '"') {
                    if (inQuotes && csvText[i+1] === '"') {
                        currentPart += '"'; // escaped quote
                        i++;
                    } else {
                        inQuotes = !inQuotes;
                    }
                } else if ((char === '\n' || char === '\r') && !inQuotes) {
                    if (char === '\r' && csvText[i+1] === '\n') continue; // Skip CR if next is LF
                    currentRow.push(currentPart);
                    currentPart = '';
                    if (currentRow.length > 1 || currentRow[0].trim() !== '') rows.push(currentRow);
                    currentRow = [];
                } else if (char === ',' && !inQuotes) {
                    currentRow.push(currentPart);
                    currentPart = '';
                } else {
                    currentPart += char;
                }
            }
            if (currentPart || currentRow.length > 0) {
                currentRow.push(currentPart);
                rows.push(currentRow);
            }

            if (rows.length === 0) return [];

            // Skip metadata to find real headers
            let headerIndex = 0;
            for (let i = 0; i < rows.length; i++) {
                if (rows[i].some(col => col.includes('Host ID') || col.includes('IP Address') || col.includes('QID'))) {
                    headerIndex = i;
                    break;
                }
            }

            const headers = rows[headerIndex].map(h => h.trim());
            return rows.slice(headerIndex + 1).map(rowCols => {
                const obj = {};
                headers.forEach((h, i) => obj[h] = (rowCols[i] || '').trim());
                return obj;
            });
        };

        const detections = parseRawCsv(hostRes.data);
        await updateProgress(`Parsed ${detections.length} Qualys detections.`);
        if (detections.length > 0) {
            const keys = Object.keys(detections[0]);
            await updateProgress(`CSV Headers found: ${keys.join(', ')}`);
            await updateProgress(`Sample row QID: ${detections[0].QID || detections[0].qid || 'NOT FOUND'}`);
        }

        // 4. Batch QIDs to get CVEs and Details
        const qids = [...new Set(detections.filter(d => d.QID || d.qid).map(d => d.QID || d.qid))];
        const cveMap = {}; // QID -> { cves: [], severity: '', cvssV3: null, cvssV2: null, title: '', desc: '', sol: '', qPatchable: false }
        
        if (qids.length > 0) {
            await updateProgress(`Lookup details for ${qids.length} unique Qualys QIDs...`);
            const batchSize = 50;
            for (let i = 0; i < qids.length; i += batchSize) {
                const batch = qids.slice(i, i + batchSize).join(',');
                const kbUri = `${QualysBaseUrl}/api/2.0/fo/knowledge_base/vuln/?action=list&ids=${batch}&details=All`;
                
                try {
                    // Note: KB API often returns XML. Since we don't have xml2js, we'll try a regex approach or check for CSV.
                    // If we can't get CSV for KB easily, we use XML + Regex.
                    const kbResp = await axios.get(kbUri, { headers: { ...qualysHeaders, 'Accept': 'text/xml' } });
                    const xml = kbResp.data;

                    // Rudimentary XML extraction for QID, CVE, and Metadata
                    const vulnBlocks = xml.split('<VULN>');
                    vulnBlocks.slice(1).forEach(block => {
                        const qidMatch = block.match(/<QID>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/QID>/);
                        if (qidMatch) {
                            const qidVal = qidMatch[1];
                            const cveMatches = [...block.matchAll(/<ID>(?:<!\[CDATA\[)?(CVE-.*?)(?:\]\]>)?<\/ID>/g)].map(m => m[1]);
                            const severity = (block.match(/<SEVERITY_LEVEL>(.*?)<\/SEVERITY_LEVEL>/)?.[1] || 
                                              block.match(/<SEVERITY>(.*?)<\/SEVERITY>/)?.[1] || 
                                              'Unknown').trim();

                            // Support various CVSS tag formats including nested <BASE> and CDATA
                            const cvssV3 = block.match(/<CVSS_V3>.*?<BASE>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/BASE>/s)?.[1] || 
                                           block.match(/<CVSS_V3_BASE>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/CVSS_V3_BASE>/)?.[1] || null;
                            const cvssV2 = block.match(/<CVSS>.*?<BASE>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/BASE>/s)?.[1] || 
                                           block.match(/<CVSS_BASE>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/CVSS_BASE>/)?.[1] || null;
                            const isQPatchable = block.match(/<PATCHABLE>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/PATCHABLE>/)?.[1] === '1';
                            
                            const titleMatch = block.match(/<TITLE>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/TITLE>/s);
                            const title = titleMatch ? titleMatch[1].trim() : 'Qualys Vulnerability';
                            
                            const descMatch = block.match(/<DESCRIPTION>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/DESCRIPTION>/s);
                            const desc = descMatch ? descMatch[1].trim() : '';
                            
                            const solMatch = block.match(/<SOLUTION>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/SOLUTION>/s);
                            const sol = solMatch ? solMatch[1].trim() : '';
                            
                            cveMap[qidVal] = { 
                                cves: cveMatches, 
                                severity, 
                                cvssV3: cvssV3 ? parseFloat(cvssV3) : null,
                                cvssV2: cvssV2 ? parseFloat(cvssV2) : null,
                                title, desc, sol, qPatchable: isQPatchable
                            };
                        }
                    });
                } catch (e) {
                    console.error(`KB Lookup failed for batch ${i}:`, e.message);
                }
            }
        }

        // 5. Fetch Action1 Vulnerability Catalog
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
                    // Safety break
                    if (offset > 100000) hasMore = false;
                }
            }
            await updateProgress(`Cataloged ${totalFetched} Action1 vulnerabilities.`);
        } catch(e) {
            await updateProgress(`Failed fetching Action1 vulns: ${e.message}`);
        }

        // 6. NIST NVD Lookup (Progressive Strategy)
        const allDiscoveredCVEs = new Set();
        for (let qid in cveMap) {
            cveMap[qid].cves.forEach(c => allDiscoveredCVEs.add(c));
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

        // 7. Reconcile Everything
        await updateProgress("Reconciling Qualys hosts and Action1 inventory with NIST verification...");
        let endpointSeverityCounts = {};
        const qualysHostsSeen = {}; // normalized name -> asset details
        const endpointUniqueCVEs = {}; // hostname -> { cveId -> { ...best entry } }

        let currentHost = null;
        detections.forEach(d => {
            const dns = d['DNS Name'];
            const nbt = d['Netbios Name'];
            const ip = d['IP Address'];
            
            // If any host info is present, update the current host sticker
            if ((dns && dns !== '0') || (nbt && nbt !== '0') || (ip && ip !== '0')) {
                currentHost = { dns, nbt, ip, os: d['OS'] };
            }

            if (!currentHost) return;

            const rawName = currentHost.dns || currentHost.nbt || currentHost.ip;
            if (!rawName || rawName === '0') return;
            const name = rawName.trim().split('.')[0].toLowerCase();
            if (name === '0') return;
            
            if (!qualysHostsSeen[name]) {
                qualysHostsSeen[name] = { ipv4: currentHost.ip, os: currentHost.os, qids: new Set() };
            }
            if (d.QID) qualysHostsSeen[name].qids.add(d.QID);
        });

        // Loop all unique Qualys hosts to build vuln lists
        for (let name in qualysHostsSeen) {
            if (!endpointUniqueCVEs[name]) endpointUniqueCVEs[name] = {};
            const hostCVEMap = endpointUniqueCVEs[name];

            const asset = qualysHostsSeen[name];
            for (const qid of asset.qids) {
                const detail = cveMap[qid];
                if (!detail || !detail.cves || detail.cves.length === 0) continue;

                const cvssV3 = detail.cvssV3;
                const cvssV2 = detail.cvssV2;
                const bestScore = cvssV3 !== null ? cvssV3 : cvssV2;
                
                let sevLabel = 'Low';
                if (bestScore !== null) {
                    if (bestScore >= 9.0) sevLabel = 'Critical';
                    else if (bestScore >= 7.0) sevLabel = 'High';
                    else if (bestScore >= 4.0) sevLabel = 'Medium';
                    else sevLabel = 'Low';
                } else {
                    const sevNum = parseInt(detail.severity);
                    if (sevNum >= 5) sevLabel = 'Critical';
                    else if (sevNum >= 4) sevLabel = 'High';
                    else if (sevNum >= 3) sevLabel = 'Medium';
                    else sevLabel = 'Low';
                }

                for (const cve of detail.cves) {
                    // Hybrid Arbitration Strategy:
                    // 1. NIST Cache (Absolute Ground Truth)
                    // 2. Action1 Catalog (NIST-aligned, extremely fast)
                    // 3. Qualys Specific QID score
                    // 4. Qualys Generic QID score

                    const nist = await nvdService.getFromCache(cve);
                    const a1 = action1Vulns[cve];

                    let finalSevLabel = sevLabel; 
                    let finalScore = bestScore;

                    if (nist) {
                        finalSevLabel = nist.severity;
                        finalScore = nist.score;
                    } else if (a1 && a1.score !== null) {
                        finalSevLabel = a1.severity || sevLabel;
                        finalScore = a1.score;
                    }

                    const existing = hostCVEMap[cve];
                    
                    let useNew = false;
                    const isSpecific = detail.title.includes(cve);
                    const existingWasSpecific = existing ? existing.title.includes(cve) : false;

                    if (!existing) {
                        useNew = true;
                    } else if (isSpecific && !existingWasSpecific) {
                        useNew = true; 
                    } else if (!isSpecific && existingWasSpecific) {
                        useNew = false; 
                    } else {
                        const existingHasScore = existing.cvss !== null;
                        const newHasScore = finalScore !== null;
                        
                        if (newHasScore && !existingHasScore) {
                            useNew = true; 
                        } else if (newHasScore && existingHasScore) {
                            if (finalScore >= existing.cvss) useNew = true; 
                        } else if (!newHasScore && !existingHasScore) {
                            const sevRank = { 'Critical': 4, 'High': 3, 'Medium': 2, 'Low': 1, 'Unknown': 0 };
                            if (sevRank[finalSevLabel] >= sevRank[existing.severity]) useNew = true;
                        }
                    }

                    if (useNew) {
                        hostCVEMap[cve] = {
                            cve,
                            severity: finalSevLabel,
                            cvss: finalScore,
                            title: detail.title,
                            desc: detail.desc,
                            sol: detail.sol,
                            status: a1 ? (a1.hasUpdates ? "Patch Available" : "No Patch Available") : "Not Recognized"
                        };
                    }

                    // Diagnostic Logging for Reported CVEs
                    const monitoredCVEs = ['CVE-2024-38203', 'CVE-2024-43629'];
                    if (monitoredCVEs.includes(cve)) {
                        console.log(`[DECISION] Host=${name} CVE=${cve} QID_Title=${detail.title}`);
                        console.log(`           NIST_Cached=${nist?nist.severity:'No'} A1_Catalog=${a1?a1.severity:'No'} Qualys=${sevLabel}`);
                    }
                }
            }
        }

        // Finalize lists and counts from de-duplicated data
        const finalCVEList = [];
        let nistVerifiedCount = 0;
        let totalUniqueCVEs = 0;

        for (let name in endpointUniqueCVEs) {
            endpointSeverityCounts[name] = { Critical: 0, High: 0, Medium: 0, Low: 0, Patchable: 0 };
            const hostCVEMap = endpointUniqueCVEs[name];
            for (let cveId in hostCVEMap) {
                const cve = hostCVEMap[cveId];
                totalUniqueCVEs++;
                
                // Track NIST coverage
                if (cve.cvss !== null) nistVerifiedCount++;

                if (cve.severity === 'Critical') endpointSeverityCounts[name].Critical++;
                else if (cve.severity === 'High') endpointSeverityCounts[name].High++;
                else if (cve.severity === 'Medium') endpointSeverityCounts[name].Medium++;
                else endpointSeverityCounts[name].Low++;

                if (cve.status === 'Patch Available') {
                    endpointSeverityCounts[name].Patchable++;
                }

                finalCVEList.push({
                    integration_id: 'qualys',
                    endpoint_name: name,
                    cve: cve.cve,
                    severity: cve.severity,
                    plugin_name: cve.title,
                    description: cve.desc,
                    solution: cve.sol,
                    status: cve.status
                });
            }
        }

        const coveragePercent = totalUniqueCVEs > 0 ? Math.round((nistVerifiedCount / totalUniqueCVEs) * 100) : 0;
        await updateProgress(`Sync finalized. NIST Verification Coverage: ${coveragePercent}% (${nistVerifiedCount}/${totalUniqueCVEs} unique CVEs).`);

        // Summary counts for logging
        let totalC = 0, totalH = 0, totalM = 0, totalL = 0;
        for (let name in endpointSeverityCounts) {
            totalC += endpointSeverityCounts[name].Critical;
            totalH += endpointSeverityCounts[name].High;
            totalM += endpointSeverityCounts[name].Medium;
            totalL += endpointSeverityCounts[name].Low;
        }
        await updateProgress(`Categorization Summary: Critical=${totalC}, High=${totalH}, Medium=${totalM}, Low=${totalL}`);

        const endpointsToSave = [];
        // Reconcile Action1
        for (let name in a1eps) {
            const d = a1eps[name];
            const sevs = endpointSeverityCounts[name] || { Critical: 0, High: 0, Medium: 0, Low: 0, Patchable: 0 };
            endpointsToSave.push({
                integration_id: 'qualys', run_id: runId, endpoint_name: name,
                ipv4: d.ipv4, mac: d.mac, os: d.os, action1_id: d.id,
                has_agent: !!qualysHostsSeen[name],
                missing_from_vm: !qualysHostsSeen[name],
                missing_from_action1: false,
                critical: sevs.Critical, high: sevs.High, medium: sevs.Medium, low: sevs.Low, patchable: sevs.Patchable
            });
        }
        // Reconcile Qualys (not in Action1)
        for (let name in qualysHostsSeen) {
            if (!a1eps[name]) {
                const d = qualysHostsSeen[name];
                const sevs = endpointSeverityCounts[name] || { Critical: 0, High: 0, Medium: 0, Low: 0, Patchable: 0 };
                endpointsToSave.push({
                    integration_id: 'qualys', run_id: runId, endpoint_name: name,
                    ipv4: d.ipv4, mac: null, os: d.os, action1_id: null,
                    has_agent: true,
                    missing_from_vm: false,
                    missing_from_action1: true,
                    critical: sevs.Critical, high: sevs.High, medium: sevs.Medium, low: sevs.Low, patchable: sevs.Patchable
                });
            }
        }


        // 8. Save to DB
        await updateProgress(`Saving data for ${endpointsToSave.length} total machines...`);
        const action1EndpointCounts = {};
        const action1EndpointIds = endpointsToSave.filter(e => e.action1_id).map(e => e.action1_id);

        if (action1EndpointIds.length > 0) {
            await updateProgress(`Fetching authoritative Action1 vulnerability counts for ${action1EndpointIds.length} endpoints...`);
            const batchSize = 10;
            for (let i = 0; i < action1EndpointIds.length; i += batchSize) {
                const batch = action1EndpointIds.slice(i, i + batchSize);
                await Promise.all(batch.map(async (id) => {
                    try {
                        action1EndpointCounts[id] = await fetchAction1EndpointVulnCounts(a1Base, Action1OrgID, id, a1Headers);
                    } catch {
                        action1EndpointCounts[id] = null;
                    }
                }));
            }
        }

        await new Promise((resolveDb, rejectDb) => {
            db.serialize(() => {
                db.run('BEGIN TRANSACTION');
                
                for (let ep of endpointsToSave) {
                    const action1Counts = ep.action1_id ? action1EndpointCounts[ep.action1_id] : null;
                    const qualysCves = endpointUniqueCVEs[ep.endpoint_name] || {};
                    const mergedCounts = countBySeverity(mergeCveMaps(qualysCves, action1Counts?.cves || {}));
                    const integrationTotal = ep.critical + ep.high + ep.medium + ep.low;
                    db.run(`INSERT INTO endpoints (integration_id, run_id, endpoint_name, ipv4, mac, os, action1_id, tenable_has_agent, missing_from_tenable, missing_from_action1, defender_total_vulns, critical_vulns, high_vulns, medium_vulns, low_vulns, action1_critical_vulns, action1_high_vulns, action1_medium_vulns, action1_low_vulns, patchable_vulns)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            ep.integration_id, runId, ep.endpoint_name, ep.ipv4, ep.mac, ep.os, ep.action1_id,
                            ep.has_agent, ep.missing_from_vm, ep.missing_from_action1,
                            integrationTotal,
                            mergedCounts.Critical, mergedCounts.High, mergedCounts.Medium, mergedCounts.Low,
                            action1Counts?.Critical || 0,
                            action1Counts?.High || 0,
                            action1Counts?.Medium || 0,
                            action1Counts?.Low || 0,
                            action1Counts?.total || 0
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

        // Cleanup
        db.run(`DELETE FROM endpoints WHERE integration_id = 'qualys' AND run_id != ?`, [runId]);
        db.run(`DELETE FROM endpoint_cves WHERE integration_id = 'qualys' AND run_id != ?`, [runId]);

        await computeAndSaveRunMetrics(runId, 'qualys');

        await updateProgress("Sync complete.");
        await new Promise(res => {
            db.run('UPDATE sync_history SET status = ?, details = ?, assets_processed = ? WHERE id = ?',
                ['Success', fullLogStr, endpointsToSave.length, runId], res);
        });
        db.run('UPDATE integrations SET last_sync = CURRENT_TIMESTAMP WHERE id = ?', ['qualys']);

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
  computeAndSaveRunMetrics = context.services.computeAndSaveRunMetrics;
  nvdService = context.services.nvd;
  return runSync();
}

module.exports = {
  sync
};
