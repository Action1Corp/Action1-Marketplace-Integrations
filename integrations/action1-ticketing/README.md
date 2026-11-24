# Action1 Ticketing Connector

## Availability

This package provides the shared Action1 signal, ticket-content, lifecycle, provider-management, Mapping, Sync, Scheduler, and History foundations. ConnectWise PSA is registered as the first provider. This release supports saving its connection settings, testing the connection, and activating the provider after a successful read-only connection test. Ticket routing and ticket delivery operations are not implemented yet; do not enable a schedule expecting destination tickets to be delivered.

When every signal type is disabled, synchronization completes successfully as a zero-work run without reading Action1 data or contacting a ticketing provider. When any signal is enabled before ticket delivery is implemented, synchronization stops safely during configuration preflight. It does not fall back to Halo. No ticket create, read, update, discovery, or lifecycle operations are available in this release.

The Action1 Signal Engine preserves donor collection, normalization, qualification, grouping, identity, defaults, and paging behavior. The Ticket Content Engine preserves donor titles, facts, ordering, caps, truncation, and regional Action1 links, with Action1 Ticketing branding. Package tests use synthetic providers and controlled in-memory transports; these providers are test fixtures only and are not available in production.

The package retains read-only Halo donor utilities and reference materials for provenance and regression context. They do not make Halo a supported provider, and destination ticket writes remain denied.

## Sync and History

Manual and scheduled runs use the same Marketplace tracked Sync action. A run captures the active provider and its configuration at start. The Sync page shows the active provider separately from the provider recorded for the last completed run. History remains read-only, shows recent tracked runs and their recorded provider, and labels older runs without attribution as “Provider not recorded.” Marketplace owns run history and failure notifications. Installed Marketplace schedule and runtime behavior must be verified for the deployed package before relying on them.

## Credentials and safety

Action1 credentials remain Marketplace-owned and are resolved with `context.action1.getCredentials()`. The package does not declare Action1 credentials in its settings schema. No real vendor credentials are included in the package.

The Halo destination client denies every non-read method before resolving a connection or requesting a token. The manual utility's `create` and non-dry-run `cleanup` commands fail closed before reading credentials, touching files, constructing a client, or making requests. `plan`, `verify`, and cleanup preview are read-only donor utilities. Never share secrets in logs, History, screenshots, or support tickets.

## Donor reference

`docs/user-guide.md` and the retained PDF are Halo donor materials kept for provenance and regression context. They are not setup instructions for Action1 Ticketing and must not be used to configure a production integration.
