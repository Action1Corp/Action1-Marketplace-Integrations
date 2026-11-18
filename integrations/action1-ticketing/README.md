# Action1 Ticketing Connector

## Foundation status

Slice 1 establishes the donor-derived Action1 Signal and Ticket Content foundations. It does not include a supported ticketing provider. Do not install or use this package for production ticket delivery. The runtime blocks Halo ticket creation, update, and status mutation, and the copied manual utility blocks client creation and cleanup even when the donor confirmation flags are supplied.

The Action1 Signal Engine preserves donor collection, normalization, qualification, grouping, identity, defaults, and paging behavior. The Ticket Content Engine preserves donor titles, facts, ordering, caps, truncation, and regional Action1 links, with Action1 Ticketing branding. Focused package tests use synthetic credentials and controlled in-memory transports.

This package retains donor UI, read-only discovery, migration shape, and documentation as implementation inputs. Those retained surfaces do not make Halo a supported provider. Provider-specific configuration and delivery are deferred to later approved slices.

## Credentials and safety

Action1 credentials remain Marketplace-owned and are resolved with `context.action1.getCredentials()`. The package does not declare Action1 credentials in its settings schema. No real vendor credentials are included in the package.

The Halo destination client denies every non-read method before resolving a connection or requesting a token. The manual utility's `create` and non-dry-run `cleanup` commands fail closed before reading credentials, touching files, constructing a client, or making requests. `plan`, `verify`, and cleanup preview are read-only donor utilities.

## Donor reference

`docs/user-guide.md` and the retained PDF are Halo donor materials kept for provenance and regression context. They are not setup instructions for Action1 Ticketing and must not be used to configure a production integration.
