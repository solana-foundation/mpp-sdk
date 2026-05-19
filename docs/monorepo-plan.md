# MPP and x402 Monorepo Plan

This note sketches a practical path for eventually bringing `mpp-sdk` and
`x402-sdk` into one repository without forcing the protocols into one shared
abstraction too early.

## Goal

Keep MPP and x402 independently correct while making cross-language protocol
work easier to test, review, and maintain.

The monorepo should improve:

- shared interop infrastructure
- consistent language package layout
- common CI matrix management
- reusable Solana test fixtures
- maintainer visibility into protocol gaps

It should not imply that MPP and x402 are the same protocol or that their public
SDK APIs must be unified immediately.

## Proposed Shape

```text
payments-sdk/
|-- protocols/
|   |-- mpp/
|   |   |-- typescript/
|   |   |-- rust/
|   |   |-- go/
|   |   |-- python/
|   |   |-- ruby/
|   |   |-- lua/
|   |   `-- php/
|   `-- x402/
|       |-- typescript/
|       |-- rust/
|       |-- go/
|       |-- python/
|       |-- ruby/
|       |-- lua/
|       `-- php/
|-- tests/
|   |-- interop/
|   |   |-- harness/
|   |   |-- mpp/
|   |   `-- x402/
|   `-- fixtures/
|       `-- solana/
|-- docs/
`-- .github/workflows/
```

Language package names can remain protocol-specific, for example
`@solana/mpp`, `@solana/x402`, `solana_mpp`, and `solana_x402`.

## Shared Pieces

Good candidates for shared infrastructure:

- process adapter contract for interop tests
- Surfpool startup and account funding fixtures
- local Solana mint and token account helpers
- matrix filtering, timeout handling, and diagnostic reporting
- CI workflow templates
- protocol fixture corpus for valid and invalid HTTP challenges/payments

These should live below shared test or tooling directories, not inside either
protocol's core SDK.

## Separate Pieces

Keep these protocol-specific:

- MPP intent model: `charge`, `session`, `subscription`
- MPP server challenge and credential verification
- x402 payment requirement selection and exact-payment semantics
- public SDK exports and package names
- language-specific protocol core modules
- docs and examples that explain protocol behavior

Shared code should help test the protocols, not erase their boundaries.

## Migration Sequence

1. Stabilize local interop harnesses in both repos.
2. Align adapter contracts where they are already naturally similar.
3. Extract only test utilities that are duplicated and stable.
4. Add a shared fixture corpus for Solana payment scenarios.
5. Move repos into one tree with package paths preserved.
6. Convert CI into a protocol-by-language matrix.
7. Only then evaluate whether any SDK internals deserve shared packages.

The first extraction target should be the harness runner and fixtures, not the
protocol implementations.

## CI Shape

CI should support narrow and full runs:

- protocol-only: MPP or x402
- language-only: TypeScript, Rust, Go, Python, Ruby, Lua, PHP
- intent/scheme-only: MPP charge/session/subscription or x402 exact
- pair-only: one client implementation against one server implementation
- full release gate: all stable matrix pairs

Every failure should report:

- protocol
- intent or scheme
- client implementation
- server implementation
- adapter command
- selected fixture
- final HTTP status
- relevant response body and recent stderr

## What Not To Do Yet

Avoid these until both repos have stronger interop coverage:

- merging public SDK APIs
- introducing a generic "payment protocol" abstraction
- moving MPP and x402 into one protocol core
- sharing verification logic before fixtures prove identical behavior
- broad package renames
- large multi-language refactors in one PR

The safe path is shared harness first, shared protocol code later only if it is
proven by tests and review.

## Near-Term PR Candidates

Small PRs that move toward this shape:

1. Document the shared adapter contract in both repos.
2. Add per-protocol fixture IDs to interop result output.
3. Standardize matrix filter naming and timeout behavior.
4. Extract repeated Surfpool setup notes into harness docs.
5. Add a compact matrix status document for MPP and x402.

Each PR should be reviewable on its own and should avoid changing protocol
behavior unless the interop harness exposes a concrete gap.
