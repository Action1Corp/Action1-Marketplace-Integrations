const crypto = require('crypto');
const { loadPolicyCatalogContract, normalizeParameterValues } = require('./policyCatalogContract');
const {
  POLICIES_TABLE,
  POLICY_CONTROLS_TABLE,
  SCOPE_RESERVATIONS_TABLE,
  AUTOMATION_CORRELATIONS_TABLE
} = require('./policyTables');
const { createAutomationCorrelationStore } = require('./automationCorrelationStore');
const { createAction1DiscoveryClient } = require('./action1DiscoveryClient');
const { writeAction1RuntimeLog } = require('./runtimeLogging');
const { buildAutomationDisplayName } = require('./automationNaming');

const POLICY_ID_PREFIX = 'POL-';
const POLICY_ID_WIDTH = 6;
const EM_DASH = '\u2014';

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeInteger(value, fieldLabel) {
  const normalized = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (!Number.isInteger(normalized)) {
    throw new Error(`${fieldLabel} must be a whole number.`);
  }
  return normalized;
}

function normalizeBoolean(value) {
  return !(value === false || value === 'false' || value === 0 || value === '0');
}

function isValidTime(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deriveDisplayName(baseName, scopeLabel) {
  const trimmedBaseName = trimString(baseName);
  const trimmedScopeLabel = trimString(scopeLabel);

  if (!trimmedScopeLabel) {
    return trimmedBaseName;
  }

  return `${trimmedBaseName} ${EM_DASH} ${trimmedScopeLabel}`;
}

function formatPolicyId(sequence) {
  return `${POLICY_ID_PREFIX}${String(sequence).padStart(POLICY_ID_WIDTH, '0')}`;
}

function sanitizeDescription(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSelectedControls(selectedControls, catalogContract) {
  if (!Array.isArray(selectedControls) || selectedControls.length === 0) {
    throw new Error('Select at least one Control.');
  }

  const seenControlIds = new Set();

  return selectedControls.map((selectedControl) => {
    const controlId = trimString(selectedControl?.controlId);
    const control = catalogContract.controlsById[controlId];
    if (!control) {
      throw new Error('Selected Control is not available in the released Control Pack.');
    }

    const controlVersion = trimString(selectedControl?.controlVersion);
    if (controlVersion !== control.version) {
      throw new Error(`Selected Control ${controlId} does not match the released Control Pack version.`);
    }

    const automationGroupId = trimString(selectedControl?.automationGroupId);
    const controlFamily = catalogContract.controlFamiliesById[automationGroupId];
    if (!controlFamily || automationGroupId !== control.automationGroupId) {
      throw new Error(`Selected Control ${controlId} is not aligned to a released automation group.`);
    }

    const automationGroupVersion = trimString(selectedControl?.automationGroupVersion);
    if (automationGroupVersion !== controlFamily.version) {
      throw new Error(`Selected Control ${controlId} does not match the released automation group version.`);
    }

    if (seenControlIds.has(controlId)) {
      throw new Error(`Control ${controlId} can only be selected once.`);
    }
    seenControlIds.add(controlId);

    const parameters = normalizeParameterValues(control, selectedControl?.parameters || {});

    return {
      controlId,
      controlVersion,
      automationGroupId,
      automationGroupVersion,
      parameters
    };
  });
}

function normalizeAndValidatePolicyInput(input = {}, catalogContract) {
  const mode = input.mode === 'edit' ? 'edit' : 'create';
  const baseName = trimString(input.baseName);
  if (!baseName) {
    throw new Error('Policy name is required.');
  }

  const organizationId = trimString(input.organizationId);
  if (!organizationId) {
    throw new Error('Organization is required.');
  }

  const organizationName = trimString(input.organizationName || input.organizationNameSnapshot);
  if (!organizationName) {
    throw new Error('Organization name is required.');
  }

  const scopeType = trimString(input.scopeType);
  if (scopeType !== 'ALL_ENDPOINTS' && scopeType !== 'ENDPOINT_GROUP') {
    throw new Error('Scope is required.');
  }

  const endpointGroupId = scopeType === 'ENDPOINT_GROUP' ? trimString(input.endpointGroupId) : '';
  const endpointGroupName = scopeType === 'ENDPOINT_GROUP' ? trimString(input.endpointGroupName || input.endpointGroupNameSnapshot) : '';
  if (scopeType === 'ENDPOINT_GROUP' && !endpointGroupId) {
    throw new Error('Endpoint group is required.');
  }
  if (scopeType === 'ENDPOINT_GROUP' && !endpointGroupName) {
    throw new Error('Endpoint group name is required.');
  }

  const policyMode = trimString(input.policyMode);
  if (policyMode !== 'ASSESS_ONLY' && policyMode !== 'ASSESS_AND_REMEDIATE') {
    throw new Error('Policy mode is required.');
  }

  const runEveryHours = normalizeInteger(input.runSchedule?.runEveryHours, 'Run every');
  if (runEveryHours <= 0) {
    throw new Error('Run every must be a positive number of hours.');
  }

  const startDate = trimString(input.runSchedule?.startDate);
  if (!startDate) {
    throw new Error('Start date is required.');
  }

  const startTime = trimString(input.runSchedule?.startTime);
  if (!isValidTime(startTime)) {
    throw new Error('Start time must use HH:mm.');
  }

  const timezone = trimString(input.runSchedule?.timezone);
  if (!timezone) {
    throw new Error('Timezone is required.');
  }

  const completionDeadlineMinutes = normalizeInteger(input.completionDeadlineMinutes, 'Completion deadline');
  if (completionDeadlineMinutes <= 0) {
    throw new Error('Completion deadline must be a positive number of minutes.');
  }

  const packId = trimString(input.controlPackId || catalogContract.packId);
  const packVersion = trimString(input.controlPackVersion || catalogContract.packVersion);
  if (packId !== catalogContract.packId || packVersion !== catalogContract.packVersion) {
    throw new Error('Policy must use the current released Control Pack.');
  }

  const selectedControls = normalizeSelectedControls(input.selectedControls, catalogContract);
  const displayName = deriveDisplayName(baseName, scopeType === 'ALL_ENDPOINTS' ? 'All endpoints' : endpointGroupName);

  const normalized = {
    mode,
    policyId: trimString(input.policyId),
    enabled: normalizeBoolean(input.enabled),
    baseName,
    description: sanitizeDescription(input.description),
    displayName,
    organizationId,
    organizationNameSnapshot: organizationName,
    scopeType,
    endpointGroupId: endpointGroupId || null,
    endpointGroupNameSnapshot: endpointGroupName || null,
    policyMode,
    runSchedule: {
      runEveryHours,
      startDate,
      startTime,
      timezone
    },
    completionDeadlineMinutes,
    controlPackId: catalogContract.packId,
    controlPackVersion: catalogContract.packVersion,
    selectedControls
  };

  if (mode === 'edit' && !normalized.policyId) {
    throw new Error('Policy id is required.');
  }

  return normalized;
}

function normalizePolicyRow(row) {
  if (!row) {
    return null;
  }

  return {
    policySequence: Number(row.policy_sequence),
    policyId: String(row.policy_id),
    enabled: Number(row.enabled) === 1,
    baseName: String(row.base_name),
    description: row.description || '',
    displayName: String(row.display_name),
    organizationId: String(row.organization_id),
    organizationNameSnapshot: String(row.organization_name_snapshot),
    scopeType: String(row.scope_type),
    endpointGroupId: row.endpoint_group_id || '',
    endpointGroupNameSnapshot: row.endpoint_group_name_snapshot || '',
    policyMode: String(row.policy_mode),
    runSchedule: {
      runEveryHours: Number(row.run_every_hours),
      startDate: String(row.start_date),
      startTime: String(row.start_time),
      timezone: String(row.timezone)
    },
    completionDeadlineMinutes: Number(row.completion_deadline_minutes),
    controlPackId: String(row.control_pack_id),
    controlPackVersion: String(row.control_pack_version),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null
  };
}

async function runInTransaction(context, work) {
  await context.db.run('BEGIN');
  try {
    const result = await work();
    await context.db.run('COMMIT');
    return result;
  } catch (error) {
    await context.db.run('ROLLBACK');
    throw error;
  }
}

async function getHydratedPolicy(context, policyId) {
  await writeAction1RuntimeLog(context, 'debug', `Hydrating Policy ${policyId}`);
  const row = await context.db.get(
    `SELECT policy_sequence, policy_id, base_name, display_name, description, organization_id, organization_name_snapshot,
            scope_type, endpoint_group_id, endpoint_group_name_snapshot, policy_mode, run_every_hours, start_date, start_time,
            timezone, completion_deadline_minutes, enabled, control_pack_id, control_pack_version, created_at, updated_at
       FROM ${POLICIES_TABLE}
      WHERE policy_id = ?`,
    [policyId]
  );

  const policy = normalizePolicyRow(row);
  if (!policy) {
    return null;
  }

  const controlRows = await context.db.all(
    `SELECT control_id, control_version, automation_group_id, automation_group_version, parameters_json
       FROM ${POLICY_CONTROLS_TABLE}
      WHERE policy_id = ?
      ORDER BY id ASC`,
    [policyId]
  );

  let action1Automations;
  try {
    action1Automations = await createAutomationCorrelationStore(context).listCorrelations(policyId);
    await writeAction1RuntimeLog(context, 'debug', `Loaded ${action1Automations.length} automation correlations for Policy ${policyId}`);
  } catch (error) {
    await writeAction1RuntimeLog(context, 'error', `Correlation hydration failed: Policy ${policyId}, stage=hydrate-correlations, message=${String(error.message || error).slice(0, 240)}`);
    throw error;
  }
  await writeAction1RuntimeLog(context, 'debug', `Projected ${action1Automations.length} automation correlations into Policy Details`);
  let action1ConsoleOrigin = '';
  try {
    action1ConsoleOrigin = await createAction1DiscoveryClient(context).resolveAction1ConsoleOrigin();
    await writeAction1RuntimeLog(context, 'debug', `Action1 console host resolved: ${action1ConsoleOrigin}`);
  } catch (error) {
    await writeAction1RuntimeLog(context, 'debug', `Action1 console host unavailable: ${String(error.message || error).slice(0, 160)}`);
  }

  return {
    ...policy,
    selectedControls: (Array.isArray(controlRows) ? controlRows : []).map((controlRow) => ({
      controlId: String(controlRow.control_id),
      controlVersion: String(controlRow.control_version),
      automationGroupId: String(controlRow.automation_group_id),
      automationGroupVersion: String(controlRow.automation_group_version),
      parameters: JSON.parse(controlRow.parameters_json || '{}')
    })),
    action1Automations: action1Automations.map((automation) => ({
      ...automation,
      canonicalAutomationName: buildAutomationDisplayName({
        policyId: policy.policyId,
        policyName: policy.baseName || policy.displayName,
        controlFamilyName: automation.controlFamilyNameSnapshot
      }),
      action1ConsoleUrl: action1ConsoleOrigin
        ? buildAction1ConsoleAutomationUrl(
          action1ConsoleOrigin,
          automation.action1OrganizationId,
          buildAutomationDisplayName({
            policyId: policy.policyId,
            policyName: policy.baseName || policy.displayName,
            controlFamilyName: automation.controlFamilyNameSnapshot
          })
        )
        : null
    }))
  };
}

function buildAction1ConsoleAutomationUrl(origin, organizationId, automationName) {
  const url = new URL('/console/automations', origin);
  url.search = new URLSearchParams({
    limit: '200', from: '0', 'add_endpoints-limit': '200', 'add_endpoints-from': '0', org: organizationId,
    filter: encodeURIComponent(automationName)
  }).toString();
  return url.toString();
}

async function assertNoScopeConflict(context, normalized) {
  const reservations = await context.db.all(
    `SELECT policy_id, organization_id, scope_type, endpoint_group_id
       FROM ${SCOPE_RESERVATIONS_TABLE}
      WHERE organization_id = ?`,
    [normalized.organizationId]
  );

  const rows = Array.isArray(reservations) ? reservations : [];
  const hasAllEndpointsReservation = rows.some((row) => row.scope_type === 'ALL_ENDPOINTS');
  const hasGroupReservations = rows.some((row) => row.scope_type === 'ENDPOINT_GROUP');
  const hasSameGroupReservation = rows.some(
    (row) => row.scope_type === 'ENDPOINT_GROUP' && String(row.endpoint_group_id || '') === String(normalized.endpointGroupId || '')
  );

  if (normalized.scopeType === 'ALL_ENDPOINTS' && hasGroupReservations) {
    throw new Error('All endpoints scope is unavailable because endpoint groups are already reserved for this organization.');
  }

  if (normalized.scopeType === 'ALL_ENDPOINTS' && hasAllEndpointsReservation) {
    throw new Error('All endpoints scope is already reserved for this organization.');
  }

  if (normalized.scopeType === 'ENDPOINT_GROUP' && hasAllEndpointsReservation) {
    throw new Error('Endpoint group scope is unavailable because all endpoints are already reserved for this organization.');
  }

  if (normalized.scopeType === 'ENDPOINT_GROUP' && hasSameGroupReservation) {
    throw new Error('This endpoint group is already reserved by another Policy in the organization.');
  }
}

function assertImmutableTarget(existing, normalized) {
  if (!existing) {
    throw new Error('Policy was not found.');
  }

  if (
    existing.organizationId !== normalized.organizationId ||
    existing.scopeType !== normalized.scopeType ||
    (existing.endpointGroupId || '') !== (normalized.endpointGroupId || '')
  ) {
    throw new Error('Organization and scope are immutable after a Policy is created.');
  }
}

function createTemporaryPolicyIdentity() {
  return {
    policySequence: -crypto.randomInt(1, 2147483647),
    policyId: `TMP-${crypto.randomUUID()}`
  };
}

function getInsertPolicySql(context) {
  const baseSql = `INSERT INTO ${POLICIES_TABLE} (
       policy_sequence,
       policy_id,
       base_name,
       display_name,
       description,
       organization_id,
       organization_name_snapshot,
       scope_type,
       endpoint_group_id,
       endpoint_group_name_snapshot,
       policy_mode,
       run_every_hours,
       start_date,
       start_time,
       timezone,
       completion_deadline_minutes,
       enabled,
       control_pack_id,
       control_pack_version
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  if (context.db?.raw?.provider === 'postgres') {
    return `${baseSql} RETURNING id`;
  }

  return baseSql;
}

async function insertPolicyRow(context, policyIdentity, normalized) {
  return context.db.run(
    getInsertPolicySql(context),
    [
      policyIdentity.policySequence,
      policyIdentity.policyId,
      normalized.baseName,
      normalized.displayName,
      normalized.description,
      normalized.organizationId,
      normalized.organizationNameSnapshot,
      normalized.scopeType,
      normalized.endpointGroupId,
      normalized.endpointGroupNameSnapshot,
      normalized.policyMode,
      normalized.runSchedule.runEveryHours,
      normalized.runSchedule.startDate,
      normalized.runSchedule.startTime,
      normalized.runSchedule.timezone,
      normalized.completionDeadlineMinutes,
      normalized.enabled ? 1 : 0,
      normalized.controlPackId,
      normalized.controlPackVersion
    ]
  );
}

async function finalizePolicyIdentity(context, insertedRowId) {
  const policySequence = Number(insertedRowId);
  if (!Number.isInteger(policySequence) || policySequence <= 0) {
    throw new Error('Unable to allocate a stable Policy identity.');
  }

  const policyId = formatPolicyId(policySequence);
  await context.db.run(
    `UPDATE ${POLICIES_TABLE}
        SET policy_sequence = ?,
            policy_id = ?,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [policySequence, policyId, policySequence]
  );

  return {
    policySequence,
    policyId
  };
}

async function updatePolicyRow(context, normalized) {
  await context.db.run(
    `UPDATE ${POLICIES_TABLE}
        SET base_name = ?,
            display_name = ?,
            description = ?,
            policy_mode = ?,
            run_every_hours = ?,
            start_date = ?,
            start_time = ?,
            timezone = ?,
            completion_deadline_minutes = ?,
            enabled = ?,
            updated_at = CURRENT_TIMESTAMP
      WHERE policy_id = ?`,
    [
      normalized.baseName,
      normalized.displayName,
      normalized.description,
      normalized.policyMode,
      normalized.runSchedule.runEveryHours,
      normalized.runSchedule.startDate,
      normalized.runSchedule.startTime,
      normalized.runSchedule.timezone,
      normalized.completionDeadlineMinutes,
      normalized.enabled ? 1 : 0,
      normalized.policyId
    ]
  );
}

async function replacePolicyControls(context, policyId, selectedControls) {
  await context.db.run(`DELETE FROM ${POLICY_CONTROLS_TABLE} WHERE policy_id = ?`, [policyId]);

  for (const selectedControl of selectedControls) {
    await context.db.run(
      `INSERT INTO ${POLICY_CONTROLS_TABLE} (
         policy_id,
         control_id,
         control_version,
         automation_group_id,
         automation_group_version,
         parameters_json
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        policyId,
        selectedControl.controlId,
        selectedControl.controlVersion,
        selectedControl.automationGroupId,
        selectedControl.automationGroupVersion,
        JSON.stringify(selectedControl.parameters || {})
      ]
    );
  }
}

async function insertScopeReservation(context, policyId, normalized) {
  await context.db.run(
    `INSERT INTO ${SCOPE_RESERVATIONS_TABLE} (
       policy_id,
       organization_id,
       scope_type,
       endpoint_group_id
     ) VALUES (?, ?, ?, ?)`,
    [policyId, normalized.organizationId, normalized.scopeType, normalized.endpointGroupId]
  );
}

async function listOrganizationReservations(context, organizationId, excludePolicyId) {
  const normalizedOrganizationId = trimString(organizationId);
  const normalizedExcludePolicyId = trimString(excludePolicyId);
  const rows = await context.db.all(
    `SELECT policy_id, organization_id, scope_type, endpoint_group_id
       FROM ${SCOPE_RESERVATIONS_TABLE}
      WHERE organization_id = ?`,
    [normalizedOrganizationId]
  );

  return (Array.isArray(rows) ? rows : []).filter((row) => trimString(row.policy_id) !== normalizedExcludePolicyId);
}

function createDbPolicyStore(context, options = {}) {
  const catalogContract = options.catalogContract || loadPolicyCatalogContract();

  return {
    async listPolicies() {
      const rows = await context.db.all(
        `SELECT policy_sequence, policy_id, base_name, display_name, description, organization_id, organization_name_snapshot,
                scope_type, endpoint_group_id, endpoint_group_name_snapshot, policy_mode, run_every_hours, start_date, start_time,
                timezone, completion_deadline_minutes, enabled, control_pack_id, control_pack_version, created_at, updated_at
           FROM ${POLICIES_TABLE}
          ORDER BY LOWER(display_name) ASC, display_name ASC, policy_sequence ASC`
      );

      const policies = [];
      for (const row of Array.isArray(rows) ? rows : []) {
        const hydrated = await getHydratedPolicy(context, row.policy_id);
        if (hydrated) {
          policies.push(hydrated);
        }
      }
      return policies;
    },

    async getPolicy(policyId) {
      return getHydratedPolicy(context, trimString(policyId));
    },

    async savePolicy(input) {
      const normalized = normalizeAndValidatePolicyInput(input, catalogContract);

      if (normalized.mode === 'create') {
        return runInTransaction(context, async () => {
          await assertNoScopeConflict(context, normalized);
          const temporaryIdentity = createTemporaryPolicyIdentity();
          const insertResult = await insertPolicyRow(context, temporaryIdentity, normalized);
          const finalizedIdentity = await finalizePolicyIdentity(context, insertResult?.lastID);
          await replacePolicyControls(context, finalizedIdentity.policyId, normalized.selectedControls);
          await insertScopeReservation(context, finalizedIdentity.policyId, normalized);
          return getHydratedPolicy(context, finalizedIdentity.policyId);
        });
      }

      return runInTransaction(context, async () => {
        const existing = await getHydratedPolicy(context, normalized.policyId);
        assertImmutableTarget(existing, normalized);
        await updatePolicyRow(context, normalized);
        await replacePolicyControls(context, normalized.policyId, normalized.selectedControls);
        return getHydratedPolicy(context, normalized.policyId);
      });
    },

    async setPolicyEnabled(policyId, enabled) {
      const normalizedPolicyId = trimString(policyId);
      if (!normalizedPolicyId) {
        throw new Error('Policy id is required.');
      }

      const existing = await getHydratedPolicy(context, normalizedPolicyId);
      if (!existing) {
        throw new Error('Policy was not found.');
      }

      await context.db.run(
        `UPDATE ${POLICIES_TABLE}
            SET enabled = ?,
                updated_at = CURRENT_TIMESTAMP
          WHERE policy_id = ?`,
        [normalizeBoolean(enabled) ? 1 : 0, normalizedPolicyId]
      );

      return getHydratedPolicy(context, normalizedPolicyId);
    },

    async getOrganizationTargetAvailability(organizationId, options = {}) {
      const normalizedOrganizationId = trimString(organizationId);
      if (!normalizedOrganizationId) {
        throw new Error('Organization id is required.');
      }

      const reservations = await listOrganizationReservations(context, normalizedOrganizationId, options.excludePolicyId);
      const reservedPolicyIdByEndpointGroupId = {};
      let allEndpointsAvailable = true;

      for (const row of reservations) {
        const scopeType = trimString(row.scope_type);
        if (scopeType === 'ALL_ENDPOINTS') {
          allEndpointsAvailable = false;
          continue;
        }

        if (scopeType === 'ENDPOINT_GROUP') {
          const endpointGroupId = trimString(row.endpoint_group_id);
          if (endpointGroupId) {
            reservedPolicyIdByEndpointGroupId[endpointGroupId] = trimString(row.policy_id);
            allEndpointsAvailable = false;
          }
        }
      }

      return {
        allEndpointsAvailable,
        reservedPolicyIdByEndpointGroupId
      };
    },

    async deletePolicy(policyId) {
      const normalizedPolicyId = trimString(policyId);
      if (!normalizedPolicyId) {
        throw new Error('Policy id is required.');
      }

      const existing = await getHydratedPolicy(context, normalizedPolicyId);
      if (!existing) {
        return { deleted: false, policy: null };
      }

      await runInTransaction(context, async () => {
        await context.db.run(`DELETE FROM ${AUTOMATION_CORRELATIONS_TABLE} WHERE policy_id = ?`, [normalizedPolicyId]);
        await context.db.run(`DELETE FROM ${POLICY_CONTROLS_TABLE} WHERE policy_id = ?`, [normalizedPolicyId]);
        await context.db.run(`DELETE FROM ${SCOPE_RESERVATIONS_TABLE} WHERE policy_id = ?`, [normalizedPolicyId]);
        await context.db.run(`DELETE FROM ${POLICIES_TABLE} WHERE policy_id = ?`, [normalizedPolicyId]);
      });

      return {
        deleted: true,
        policy: clone(existing)
      };
    }
  };
}

module.exports = {
  buildAction1ConsoleAutomationUrl,
  createDbPolicyStore,
  createTemporaryPolicyIdentity,
  formatPolicyId,
  normalizeAndValidatePolicyInput
};
