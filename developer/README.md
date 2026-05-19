# Developer Resources

This directory contains integration developer materials that should not be loaded by the Marketplace runtime.

## Contents

- `examples/hello-integration`: minimal complete example integration
- `docs/GETTING_STARTED.md`: step-by-step first integration walkthrough
- `docs/DEVELOPER_CONTRACT.md`: developer-facing contract and SDK usage
- `docs/MARKETPLACE_INTEGRATION_API.md`: versioned integration API reference
- `docs/DISPLAY_REFERENCE.md`: `display.json` screens, columns, and dashboard reference
- `docs/SCHEMA_REFERENCE.md`: integration-owned database schema guidance
- `docs/LOCAL_TESTING.md`: local Marketplace container testing workflow
- `docs/NOTIFICATION_WEBHOOKS.md`: failure webhook payloads and expectations
- `docs/REVIEW_CHECKLIST.md`: pre-merge review checklist
- `docs/INTEGRATION_REPO_STRATEGY.md`: repository and packaging strategy

Only real, loadable integrations belong in the repository root `integrations/` directory.
