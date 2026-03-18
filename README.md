<p align="center">
  <img src="assets/banner.png" alt="MPP" width="100%" />
</p>

# solana-mpp-sdk

Solana payment method for the [MPP protocol](https://mpp.dev).

[MPP](https://mpp.dev) (Machine Payments Protocol) is [an open protocol proposal](https://paymentauth.org) that lets any HTTP API accept payments using the `402 Payment Required` flow.

## Features

- **Native SOL and SPL token transfers** (USDC, Token-2022, etc.)
- **Two settlement flows**: server-broadcast (`type="transaction"`, default) and client-broadcast (`type="signature"`)
- **Fee sponsorship**: server pays transaction fees on behalf of clients
- **Replay protection**: consumed transaction signatures are tracked
- Works with [ConnectorKit](https://github.com/nicolo-ribaudo/connector-kit), `@solana/kit` keypair signers, or any `TransactionSigner`

## Architecture

```
solana-mpp-sdk/
├── sdk/src/
│   ├── Methods.ts          # Shared charge schema (Method.from)
│   ├── constants.ts        # Token programs, USDC mints, RPC URLs
│   ├── server/
│   │   └── Charge.ts       # Server: generate challenge, verify on-chain
│   └── client/
│       └── Charge.ts       # Client: build tx, sign, send
├── examples/
│   ├── server.ts           # USDC-gated API (devnet)
│   └── client.ts           # Headless client with keypair
└── demo/                   # Interactive playground (see demo/README.md)
```

**Exports:**
- `solana-mpp-sdk` — shared method schema + constants
- `solana-mpp-sdk/server` — server-side charge + `Mppx`, `Store` from mppx
- `solana-mpp-sdk/client` — client-side charge + `Mppx` from mppx

## Quick Start

### Server

```ts
import { Mppx, solana } from 'solana-mpp-sdk/server'

const mppx = Mppx.create({
  secretKey: process.env.MPP_SECRET_KEY,
  methods: [
    solana.charge({
      recipient: 'RecipientPubkey...',
      splToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      decimals: 6,
      network: 'mainnet-beta',
    }),
  ],
})

// In your request handler:
const result = await mppx.charge({
  amount: '1000000', // 1 USDC
  currency: 'USDC',
})(request)

if (result.status === 402) return result.challenge
return result.withReceipt(Response.json({ data: '...' }))
```

### Client

```ts
import { Mppx, solana } from 'solana-mpp-sdk/client'

const method = solana.charge({ signer }) // any TransactionSigner
const mppx = Mppx.create({ methods: [method] })

const response = await mppx.fetch('https://api.example.com/paid-endpoint')
const data = await response.json()
```

### Fee Sponsorship

The server can pay transaction fees on behalf of clients:

```ts
// Server — pass a KeyPairSigner to cover fees
solana.charge({
  recipient: '...',
  signer: feePayerSigner, // server's KeyPairSigner
})

// Client — no changes needed, fee payer is handled automatically
```

## How It Works

1. Client requests a resource
2. Server returns **402 Payment Required** with a challenge (`recipient`, `amount`, `currency`)
3. Client builds and signs a Solana transfer transaction
4. Server broadcasts, confirms on-chain, verifies the transfer
5. Server returns the resource with a `Payment-Receipt` header

With fee sponsorship, the client partially signs (transfer authority only) and the server co-signs as fee payer before broadcasting.

## Development

```bash
npm install

# Typecheck
npm run typecheck

# Unit tests (no network needed)
npm test

# Integration tests (requires Surfpool on localhost:8899)
npm run test:integration

# All tests
npm run test:all
```

### Demo

See [demo/README.md](demo/README.md) for an interactive playground with Surfpool.

```bash
surfpool start
npm run demo:install
npm run demo:server
npm run demo:app
```

## Spec

This SDK implements the [Solana Charge Intent](https://github.com/anthropics/mpp-specs/blob/main/specs/methods/solana/draft-solana-charge-00.md) for the [HTTP Payment Authentication Scheme](https://paymentauth.org).

## License

MIT
