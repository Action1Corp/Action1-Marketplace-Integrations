export const demoOrganizations = [
  { organizationId: 'org-acme', organizationName: 'Acme Corp' },
  { organizationId: 'org-fabrikam', organizationName: 'Fabrikam' }
];

export const demoEndpointGroups = {
  'org-acme': [
    { endpointGroupId: 'group-finance-workstations', endpointGroupName: 'Finance Workstations' },
    { endpointGroupId: 'group-sales-laptops', endpointGroupName: 'Sales Laptops' }
  ],
  'org-fabrikam': [
    { endpointGroupId: 'group-headquarters', endpointGroupName: 'Headquarters' }
  ]
};

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
