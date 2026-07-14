const {
  deleteEntraOrgMapping,
  discoverAction1MappingOptions,
  listEntraOrgMappings,
  saveEntraOrgMapping
} = require('./mappingActions');

module.exports = {
  actions: {
    'delete-entra-org-mapping': deleteEntraOrgMapping,
    'discover-action1-mapping-options': discoverAction1MappingOptions,
    'list-entra-org-mappings': listEntraOrgMappings,
    'save-entra-org-mapping': saveEntraOrgMapping
  }
};
