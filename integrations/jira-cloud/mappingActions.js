const {
  discoverAction1Organizations,
  loadAction1Credentials,
  requestAction1Token,
  sanitizeMessage: sanitizeAction1Message
} = require('./action1Api');
const {
  listIssueTypesForProject,
  listProjects,
  loadSettings,
  missingRequiredSettings,
  sanitizeMessage
} = require('./jiraApi');
const { deleteMapping, listMappings, saveMapping } = require('./mappingStore');

function createShortFailureMessage(operation) {
  if (operation === 'action1_org_discovery') {
    return 'Action1 organization discovery failed.';
  }

  if (operation === 'jira_project_discovery') {
    return 'Jira project discovery failed. Check Jira project-read access and retry.';
  }

  if (operation === 'jira_issue_type_discovery') {
    return 'Jira issue type discovery failed. Check Jira project access and retry.';
  }

  return 'Unable to load mapping options.';
}

function buildFailureDiagnostics(operation, error, extras = {}) {
  const diagnostic = error?.diagnostic && typeof error.diagnostic === 'object' ? error.diagnostic : {};
  const request = diagnostic.request && typeof diagnostic.request === 'object' ? diagnostic.request : {};
  const response = diagnostic.response && typeof diagnostic.response === 'object' ? diagnostic.response : {};

  return {
    actionId:
      operation === 'action1_org_discovery'
        ? 'discover-action1-mapping-options'
        : operation === 'jira_issue_type_discovery'
        ? 'discover-jira-issue-type-mapping-options'
        : 'discover-jira-project-mapping-options',
    operation,
    jiraProjectId: extras.jiraProjectId || '',
    resolvedSiteUrl: extras.resolvedSiteUrl || diagnostic.resolvedSiteUrl || '',
    request: {
      method: request.method || '',
      path: request.path || '',
      query: request.query || ''
    },
    response: {
      status: response.status ?? null,
      contentType: response.contentType || '',
      errorCode: response.errorCode || '',
      errorMessage: response.errorMessage || sanitizeMessage(error?.message) || sanitizeAction1Message(error?.message) || '',
      bodyExcerpt: response.bodyExcerpt || ''
    },
    timestamp: new Date().toISOString()
  };
}

function logDiscoveryFailure(context, diagnostics) {
  const message = `Jira Cloud mapping discovery diagnostic ${JSON.stringify(diagnostics)}`;
  if (typeof context?.logger?.warn === 'function') {
    context.logger.warn(message);
    return;
  }

  console.warn(message);
}

async function listJiraOrgProjectMappings(context) {
  const mappings = await listMappings(context);
  return {
    ok: true,
    mappings
  };
}

async function saveJiraOrgProjectMapping(context, request = {}) {
  try {
    const saved = await saveMapping(context, request.payload || {});
    return {
      ok: true,
      message: 'Mapping saved.',
      mapping: saved,
      mappings: await listMappings(context)
    };
  } catch (error) {
    return {
      ok: false,
      message: `Failed: ${sanitizeMessage(error?.message) || 'Unable to save mapping.'}`
    };
  }
}

async function deleteJiraOrgProjectMapping(context, request = {}) {
  try {
    const result = await deleteMapping(context, request.payload?.id);
    return {
      ok: true,
      message: result.deleted ? 'Mapping deleted.' : 'Mapping was already absent.',
      deleted: result.deleted,
      mapping: result.mapping,
      mappings: await listMappings(context)
    };
  } catch (error) {
    return {
      ok: false,
      message: `Failed: ${sanitizeMessage(error?.message) || 'Unable to delete mapping.'}`
    };
  }
}

async function discoverAction1MappingOptions(context) {
  try {
    const credentials = await loadAction1Credentials(context);
    const accessToken = await requestAction1Token(credentials);
    const action1Organizations = await discoverAction1Organizations(accessToken, credentials.baseUrl);
    return {
      ok: true,
      message: 'Loaded Action1 organization options.',
      action1Organizations
    };
  } catch (error) {
    const diagnostics = buildFailureDiagnostics('action1_org_discovery', error);
    logDiscoveryFailure(context, diagnostics);
    return {
      ok: false,
      message: `Failed: ${createShortFailureMessage('action1_org_discovery')}`,
      diagnostics,
      action1Organizations: []
    };
  }
}

async function discoverJiraProjectMappingOptions(context, request = {}) {
  let resolvedSiteUrl = '';

  try {
    const settings = await loadSettings(context, request);
    resolvedSiteUrl = settings.JiraCloudSiteUrl || '';
    const missing = missingRequiredSettings(settings);

    if (missing.length > 0) {
      return {
        ok: false,
        message: `Missing required Jira Cloud settings: ${missing.join(', ')}`,
        jiraProjects: []
      };
    }

    const jiraProjects = await listProjects(settings);
    return {
      ok: true,
      message: 'Loaded Jira project options.',
      jiraProjects
    };
  } catch (error) {
    const diagnostics = buildFailureDiagnostics('jira_project_discovery', error, {
      resolvedSiteUrl
    });
    logDiscoveryFailure(context, diagnostics);
    return {
      ok: false,
      message: `Failed: ${createShortFailureMessage('jira_project_discovery')}`,
      diagnostics,
      jiraProjects: []
    };
  }
}

async function discoverJiraIssueTypeMappingOptions(context, request = {}) {
  let resolvedSiteUrl = '';
  const jiraProjectId = String(request?.payload?.jiraProjectId || '').trim();

  try {
    const settings = await loadSettings(context, request);
    resolvedSiteUrl = settings.JiraCloudSiteUrl || '';
    const missing = missingRequiredSettings(settings);

    if (missing.length > 0) {
      return {
        ok: false,
        message: `Missing required Jira Cloud settings: ${missing.join(', ')}`,
        jiraIssueTypes: []
      };
    }

    if (!jiraProjectId) {
      return {
        ok: false,
        message: 'Select a Jira project before loading Jira issue types.',
        jiraIssueTypes: []
      };
    }

    const jiraIssueTypes = await listIssueTypesForProject(settings, jiraProjectId);
    return {
      ok: true,
      message: 'Loaded Jira issue type options.',
      jiraProjectId,
      jiraIssueTypes
    };
  } catch (error) {
    const diagnostics = buildFailureDiagnostics('jira_issue_type_discovery', error, {
      jiraProjectId,
      resolvedSiteUrl
    });
    logDiscoveryFailure(context, diagnostics);
    return {
      ok: false,
      message: `Failed: ${createShortFailureMessage('jira_issue_type_discovery')}`,
      diagnostics,
      jiraProjectId,
      jiraIssueTypes: []
    };
  }
}

module.exports = {
  deleteJiraOrgProjectMapping,
  discoverAction1MappingOptions,
  discoverJiraIssueTypeMappingOptions,
  discoverJiraProjectMappingOptions,
  listJiraOrgProjectMappings,
  saveJiraOrgProjectMapping
};
