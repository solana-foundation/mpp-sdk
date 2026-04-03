<p align="center">
  <img src="https://github.com/solana-foundation/mpp-sdk/raw/main/assets/banner.png" alt="MPP" width="100%" />
</p>

# @solana/mpp

Solana payment method for the [Machine Payments Protocol](https://mpp.dev).

**MPP** is [an open protocol proposal](https://paymentauth.org) that lets any HTTP API accept payments using the `402 Payment Required` flow.

> [!IMPORTANT]
> This repository is under active development. The [Solana MPP spec](https://github.com/tempoxyz/mpp-specs/pull/188) is not yet finalized — APIs and wire formats are subject to change.

## Install

```bash
pnpm add @solana/mpp
```

## Features

**Charge** (one-time payments)
- Native SOL and SPL token transfers (USDC, PYUSD, Token-2022, etc.)
- Two settlement modes: pull (`type="transaction"`, default) and push (`type="signature"`)
- Fee sponsorship: server pays transaction fees on behalf of clients
- Split payments: send one charge to multiple recipients in a single transaction
- Replay protection via consumed transaction signatures

**General**
- Works with [ConnectorKit](https://www.connectorkit.dev), `@solana/kit` keypair signers, and [Solana Keychain](https://github.com/solana-foundation/solana-keychain) remote signers
- Server pre-fetches `recentBlockhash` to save client an RPC round-trip
- Transaction simulation before broadcast to prevent wasted fees
- Optional `tokenProgram` hint; clients resolve the mint owner and fail closed if discovery fails

## Architecture

```
mpp-sdk/
├── typescript/                    # TypeScript SDK
│   └── packages/mpp/src/
│       ├── Methods.ts             # Shared charge + session schemas
│       ├── constants.ts           # Token programs, USDC mints, RPC URLs
│       ├── server/
│       │   ├── Charge.ts          # Server: challenge, verify, broadcast
│       │   └── Session.ts         # Server: session channel management
│       ├── client/
│       │   ├── Charge.ts          # Client: build tx, sign, send
│       │   └── Session.ts         # Client: session lifecycle
│       └── session/
│           ├── Types.ts           # Session types and interfaces
│           ├── Voucher.ts         # Voucher signing and verification
│           ├── ChannelStore.ts    # Persistent channel state
│           └── authorizers/       # Pluggable authorization strategies
├── rust/                          # Rust SDK
│   └── src/lib.rs
├── go/                            # Go SDK
│   ├── client/                    # Client: build tx, sign, optional broadcast
│   ├── server/                    # Server: challenge, verify, broadcast
│   └── protocol/                  # Shared headers, challenge types, charge schema
└── demo/                          # Interactive playground
```

**Exports:**
- `@solana/mpp` — shared schemas, session types, and authorizers only
- `@solana/mpp/server` — server-side charge + session, `Mppx`, `Store`
- `@solana/mpp/client` — client-side charge + session, `Mppx`

## Quick Start

### Charge (one-time payment)

**Server:**

```ts
import { Mppx, solana } from '@solana/mpp/server'

const mppx = Mppx.create({
  secretKey: process.env.MPP_SECRET_KEY,
  methods: [
    solana.charge({
      recipient: 'RecipientPubkey...',
      currency: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      decimals: 6,
    }),
  ],
})

const result = await mppx.charge({
  amount: '1000000', // 1 USDC
  currency: 'USDC',
})(request)

if (result.status === 402) return result.challenge
return result.withReceipt(Response.json({ data: '...' }))
```

**Client:**

```ts
import { Mppx, solana } from '@solana/mpp/client'

const mppx = Mppx.create({
  methods: [solana.charge({ signer })], // any TransactionSigner
})

const response = await mppx.fetch('https://api.example.com/paid-endpoint')
```

### Fee Sponsorship (charge)

The server can pay transaction fees on behalf of clients:

```ts
// Server — pass a TransactionPartialSigner to cover fees
solana.charge({
  recipient: '...',
  signer: feePayerSigner, // KeyPairSigner, Keychain SolanaSigner, etc.
})

// Client — no changes needed, fee payer is handled automatically
```

## How It Works

### Charge Flow

1. Client requests a resource
2. Server returns **402 Payment Required** with a challenge (`recipient`, `amount`, `currency`, optional `tokenProgram`, optional `recentBlockhash`)
3. Client builds and signs a Solana transfer transaction
4. Server simulates, broadcasts, confirms on-chain, and verifies the transfer
5. Server returns the resource with a `Payment-Receipt` header

With fee sponsorship, the client partially signs (transfer authority only) and the server co-signs as fee payer before broadcasting.

### Splits (charge)

Use `splits` when one charge should pay multiple recipients in the same asset.
The top-level `amount` is the total paid. The primary `recipient` receives
`amount - sum(splits)`, and each split recipient receives its own `amount`.

```ts
import { Mppx, solana } from '@solana/mpp/server'

const mppx = Mppx.create({
  secretKey: process.env.MPP_SECRET_KEY,
  methods: [
    solana.charge({
      recipient: 'SellerPubkey...',
      currency: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      decimals: 6,
      splits: [
        { recipient: 'PlatformPubkey...', amount: '50000', memo: 'platform fee' },
        { recipient: 'ReferrerPubkey...', amount: '20000', memo: 'referral fee' },
      ],
    }),
  ],
})

const result = await mppx.charge({
  amount: '1000000', // total: 1.00 USDC
  currency: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
})(request)
```

In this example:
- seller receives `930000`
- platform receives `50000`
- referrer receives `20000`

The same `splits` shape works for native SOL charges.

## Demo

An interactive playground with a React frontend and Express backend, running against [Surfpool](https://surfpool.run).

- Charge flow demo: `http://localhost:5173/charges`
- Session flow demo: `http://localhost:5173/sessions`

```bash
surfpool start
pnpm demo:install
pnpm demo:server
pnpm demo:app
```

See [demo/README.md](demo/README.md) for full details.

## Development

```bash
# TypeScript
cd typescript && pnpm install

just ts-fmt              # Format and lint
just ts-build            # Build
just ts-test             # Unit tests (charge + session, no network)
just ts-test-integration # Integration tests (requires Surfpool)

# Rust
cd rust && cargo build

# Go
cd go && go test ./...

# Everything
just build            # Build both
just test             # Test both
just pre-commit       # Full pre-commit checks
```

## Spec

This SDK implements the [Solana Charge Intent](https://github.com/tempoxyz/mpp-specs/pull/188) for the [HTTP Payment Authentication Scheme](https://paymentauth.org).

Session method docs and implementation notes are intentionally kept out of this
README for now. See [docs/methods/sessions.md](docs/methods/sessions.md).

## License

MIT
