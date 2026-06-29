const { validate } = require('./validate');
const {
  deleteJiraOrgProjectMapping,
  discoverAction1MappingOptions,
  discoverJiraIssueTypeMappingOptions,
  discoverJiraProjectMappingOptions,
  listJiraOrgProjectMappings,
  saveJiraOrgProjectMapping
} = require('./mappingActions');
const { runJiraCloudSync } = require('./syncAction');

const SLICE_ID = 'phase-7-sync-history-logging-hardening';

async function validateConfiguration(context, request = {}) {
  const run = request.run || null;
  await run?.appendLog?.('Starting Jira Cloud configuration validation.');
  const result = await validate(context, request);
  await run?.appendLog?.(result.message);
  return result;
}

async function sync(context, request = {}) {
  const result = await runJiraCloudSync(context, request);
  return {
    ...result,
    phase: SLICE_ID
  };
}

module.exports = {
  actions: {
    'delete-jira-org-project-mapping': deleteJiraOrgProjectMapping,
    'discover-action1-mapping-options': discoverAction1MappingOptions,
    'discover-jira-issue-type-mapping-options': discoverJiraIssueTypeMappingOptions,
    'discover-jira-project-mapping-options': discoverJiraProjectMappingOptions,
    'list-jira-org-project-mappings': listJiraOrgProjectMappings,
    'save-jira-org-project-mapping': saveJiraOrgProjectMapping,
    'validate-configuration': validateConfiguration,
    sync
  }
};
