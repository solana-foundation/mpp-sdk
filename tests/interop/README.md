# MPP interop tests

This directory contains the cross-language MPP interoperability tests.

There are currently two interop layers:

- `test_*.py` runs the legacy Python client conformance suite against language-specific payment link servers.
- `src/` and `test/e2e.test.ts` run process-based client/server adapters against Surfpool. This is the adapter contract new language implementations should target.

## Process adapter contract

Each adapter is a standalone process launched by `src/process.ts`. It receives configuration through environment variables and reports machine-readable status on stdout as newline-delimited JSON.

Adapter stdout must contain only JSON protocol messages. Diagnostic logs should go to stderr so the harness can parse stdout deterministically.

### Server adapters

A server adapter starts an HTTP server on `127.0.0.1` and prints a `ready` message once it can accept requests:

```json
{"type":"ready","implementation":"typescript","role":"server","port":3000}
```

Required fields:

- `type`: `"ready"`
- `implementation`: stable implementation id from `src/implementations.ts`
- `role`: `"server"`
- `port`: local TCP port where the protected resource is served

The server must expose the shared scenario resource path from `interopScenario.resourcePath` and protect it with the MPP `charge` flow. It should return a successful JSON response after payment and include the settlement header named by `interopScenario.settlementHeader`.

### Client adapters

A client adapter receives the target URL in `MPP_INTEROP_TARGET_URL`, pays it, and prints one `result` message:

```json
{
  "type": "result",
  "implementation": "typescript",
  "role": "client",
  "ok": true,
  "status": 200,
  "responseHeaders": {"x-fixture-settlement": "..."},
  "responseBody": {"ok": true},
  "settlement": "..."
}
```

Required fields:

- `type`: `"result"`
- `implementation`: stable implementation id from `src/implementations.ts`
- `role`: `"client"`
- `ok`: whether the paid request succeeded
- `status`: final HTTP status
- `responseHeaders`: final response headers as a plain object
- `responseBody`: parsed final response body

The `settlement` field is optional, but clients should populate it when the implementation exposes settlement details.

## Shared environment

The Vitest harness prepares Surfpool state and passes these variables to each adapter:

- `MPP_INTEROP_RPC_URL`: local Surfpool RPC URL
- `MPP_INTEROP_NETWORK`: network name, currently `localnet`
- `MPP_INTEROP_MINT`: SPL mint used by the scenario
- `MPP_INTEROP_PRICE`: display price
- `MPP_INTEROP_SECRET_KEY`: deterministic server secret
- `MPP_INTEROP_CLIENT_SECRET_KEY`: JSON array for the client keypair
- `MPP_INTEROP_FEE_PAYER_SECRET_KEY`: JSON array for the server fee payer keypair
- `MPP_INTEROP_PAY_TO`: expected recipient public key
- `MPP_INTEROP_TARGET_URL`: client-only target URL

The canonical scenario values, including the integer amount expected to settle, live in `src/contracts.ts`.

## Adding an implementation

1. Add a process adapter for the language.
2. Register it in `src/implementations.ts` as a client, server, or both.
3. Keep the adapter command relative to `tests/interop`.
4. Make stdout emit only the `ready` or `result` JSON message.
5. Run a focused matrix before enabling it by default:

```bash
MPP_INTEROP_CLIENTS=<id> MPP_INTEROP_SERVERS=typescript pnpm test
MPP_INTEROP_CLIENTS=typescript MPP_INTEROP_SERVERS=<id> pnpm test
```

Enable the implementation by default only after the focused matrix is stable.

## Running

From this directory:

```bash
pnpm install --frozen-lockfile
pnpm test
```

Run one adapter pair when isolating a failure:

```bash
MPP_INTEROP_CLIENTS=rust MPP_INTEROP_SERVERS=typescript pnpm test
MPP_INTEROP_CLIENTS=typescript MPP_INTEROP_SERVERS=rust pnpm test
```

If either selection variable names no registered adapter, the suite fails with
the selected client/server lists instead of silently running an empty matrix.

If the TypeScript adapter cannot resolve `@solana/mpp/client` or
`@solana/mpp/server`, rebuild the local package and refresh the interop package
install:

```bash
cd ../../typescript
pnpm --filter @solana/mpp build

cd ../tests/interop
pnpm install --force --frozen-lockfile
pnpm test
```

`@solana/mpp` is installed from a local `file:` dependency, so
`tests/interop` needs to install after the TypeScript package has produced its
`dist` files.

The harness starts Surfpool through `start-surfnet-proxy.mjs`, funds the test accounts, starts each enabled server adapter, runs each enabled client adapter against it, and verifies the recipient balance delta.

## Python conformance suite

The legacy Python suite expects an already-running server and Surfpool RPC:

```bash
SERVER_URL=http://localhost:3002 RPC_URL=http://localhost:8899 \
  ../../python/.venv/bin/python -m pytest . -v --rootdir=.
```

Use the repo virtualenv when available; a system Python may be missing `solders`
or other Solana test dependencies.
