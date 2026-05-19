# Ruby, PHP, and Lua Package Boundaries

This note records package boundaries for future MPP subscription and session work. It is documentation-only and does not define runtime behavior, protocol changes, or release timelines.

## Current Boundary

| Language | Package status | Supported surface | Future session/subscription boundary |
| --- | --- | --- | --- |
| Lua | Existing source tree under `lua/` | Server-only charge and verification helpers | Keep server-only unless a separate client package is designed |
| PHP | No package in this repository | Not implemented | Plan as server-only first |
| Ruby | No package layout selected | Not implemented | Decide package layout before implementation |

## Lua

Lua is intended to stay server-only for now. The existing implementation targets native server environments such as Kong and OpenResty, where the SDK can issue challenges, verify credentials, and integrate with server middleware without requiring a client-side wallet or transaction builder.

Future subscription or session support should preserve that boundary:

- add server-side challenge and verification primitives only;
- keep browser, wallet, and auto-402 client behavior out of the Lua package;
- avoid adding Lua dependencies that assume a full Solana client SDK;
- document any host-provided verification callback requirements.

## PHP

PHP should be planned as a server-only package first. The likely consumer is a backend application or framework middleware that needs to protect routes with MPP charges, subscriptions, or sessions.

Future PHP work should focus on:

- framework-neutral server primitives before framework adapters;
- request/response helpers for common PHP runtimes;
- credential verification and replay protection;
- subscription or session challenge issuance.

Client auto-payment, wallet orchestration, and browser behavior should remain out of scope unless the maintainers explicitly approve a separate client package.

## Ruby

The Ruby layout is intentionally undecided. Before implementation, maintainers should choose whether Ruby lives as a standalone gem, a repository subdirectory, or a package split that can support framework adapters without coupling them to the core protocol code.

Open questions for Ruby:

- gem name and namespace;
- core package versus Rails/Rack adapter split;
- minimum supported Ruby version;
- whether session/subscription helpers belong in the first package or a later release;
- how much shared test coverage is required before publishing.

Until those questions are resolved, Ruby should be treated as a new package plan rather than an implementation surface.

## Non-Goals

This note does not:

- add Ruby or PHP package scaffolding;
- change Lua runtime behavior;
- mark subscriptions or sessions as implemented for Lua, PHP, or Ruby;
- change the published support matrix.
