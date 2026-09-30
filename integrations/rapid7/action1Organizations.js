function rows(payload, keys = []) {
    if (Array.isArray(payload)) return payload;
    for (const key of [...keys, 'items', 'data']) {
        if (Array.isArray(payload?.[key])) return payload[key];
    }
    return [];
}

async function fetchPaged(axios, buildUrl, headers, keys, limit) {
    const result = [];
    for (let offset = 0; offset <= 100000; offset += limit) {
        const response = await axios.get(buildUrl(limit, offset), { headers });
        const page = rows(response.data || {}, keys);
        result.push(...page);
        const total = Number(response.data?.total_items ?? response.data?.total ?? 0);
        if (page.length < limit || (total > 0 && offset + limit >= total)) break;
    }
    return result;
}

async function discoverAction1Inventory(axios, baseUrl, headers) {
    const rawOrganizations = await fetchPaged(
        axios,
        (limit, offset) => `${baseUrl}/organizations?limit=${limit}&from=${offset}`,
        headers,
        ['organizations'],
        500
    );
    const seen = new Set();
    const organizations = rawOrganizations.map((row) => {
        const id = String(row?.id || row?.organization_id || row?.organizationId || row?.org_id || '').trim();
        return id ? { id, name: String(row?.name || row?.organization_name || row?.display_name || id).trim() } : null;
    }).filter(Boolean).filter((organization) => {
        if (seen.has(organization.id)) return false;
        seen.add(organization.id);
        return true;
    });

    if (organizations.length === 0) throw new Error('Action1 credentials do not have access to any organizations.');

    const endpoints = [];
    for (const organization of organizations) {
        const organizationEndpoints = await fetchPaged(
            axios,
            (limit, offset) => `${baseUrl}/endpoints/managed/${encodeURIComponent(organization.id)}?limit=${limit}&from=${offset}`,
            headers,
            ['endpoints'],
            500
        );
        for (const endpoint of organizationEndpoints) {
            const matchName = String(endpoint?.device_name || '').trim().split('.')[0].toLowerCase();
            if (!matchName) continue;
            endpoints.push({
                ...endpoint,
                action1_organization_id: organization.id,
                action1_organization_name: organization.name,
                match_name: matchName
            });
        }
    }
    return { organizations, endpoints };
}

module.exports = { discoverAction1Inventory };
