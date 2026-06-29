# Jira Cloud

This integration is currently in Slice 3 project mapping adaptation.

## Current Status

- Package target: `integrations/jira-cloud/`
- Primary reference: `integrations/halo-psa/`
- Forge is explicitly excluded as an implementation reference
- The package loads as a Marketplace integration scaffold
- `validate-configuration` uses Jira `GET /rest/api/3/myself`
- Jira Project Mapping follows the HaloPSA row-based mapping pattern, adapted for Jira Project and Jira Issue Type
- `sync` remains a safe stub and does not call Jira, Action1, or create/update issues yet

## Notes

- Jira payload building, ADF conversion, correlations, candidate preparation, and issue lifecycle writes are intentionally deferred to later slices.
- Action1 credentials must continue to come from Marketplace runtime `context` and must not be declared in Jira settings.
