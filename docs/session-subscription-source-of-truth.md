# Session and Subscription Source of Truth

This note captures the current local source of truth before adding session or
subscription support to additional language SDKs.

It is intentionally descriptive. It does not propose a new protocol contract.

## Related Pay Work

The current `solana-foundation/pay` session reference is:

- `solana-foundation/pay#364`: preliminary session support
  <https://github.com/solana-foundation/pay/pull/364>
- linked spec work: `tempoxyz/mpp-specs#201`
  <https://github.com/tempoxyz/mpp-specs/pull/201>

That work reinforces the core lifecycle: open a channel first, then pay through
cumulative vouchers, then close/finalize the channel. It also highlights a
field-name drift risk that should be resolved before copying schemas blindly
between repos.

`solana-foundation/pay#363` is not a session schema change, but it is relevant
to server-side robustness because poisoned in-memory accounting state should not
take down all later verification.

The current subscription specification reference is:

- `tempoxyz/mpp-specs#230`: subscription intent plus Stripe and Tempo method
  profiles <https://github.com/tempoxyz/mpp-specs/pull/230>

That PR defines subscription as a narrow recurring fixed-amount payment
authorization. It does not model full billing-product behavior such as seats,
trials, prorations, discounts, usage-based billing, or plan changes.

## Current Code Shape

### TypeScript

TypeScript defines the shared `session` method schema in
`typescript/packages/mpp/src/Methods.ts`.

Client-side session support is implemented and exported from:

- `typescript/packages/mpp/src/client/Session.ts`
- `typescript/packages/mpp/src/client/SessionConsumer.ts`
- `typescript/packages/mpp/src/client/SessionFetch.ts`
- `typescript/packages/mpp/src/client/SessionUsageMeter.ts`
- `typescript/packages/mpp/src/client/PaymentChannels.ts`

The TypeScript client exposes `solana.session`. The TypeScript server export
currently exposes `solana.charge`; server-side session integration is not
exported through `typescript/packages/mpp/src/server/Methods.ts`.

### Rust

Rust defines session protocol types in
`rust/src/protocol/intents/session.rs` and re-exports them from
`rust/src/protocol/intents/mod.rs`.

Rust also has client and server session logic:

- `rust/src/client/session.rs`
- `rust/src/client/session_consumer.rs`
- `rust/src/client/payment_channels.rs`
- `rust/src/server/session.rs`

The Rust session server includes challenge construction, open processing,
voucher verification, delivery reservation/commit behavior, top-up handling,
and close/finalize helpers.

### Python

Python currently has charge intent types in
`python/src/solana_mpp/protocol/intents.py`.

No Python `SessionRequest`, `SessionAction`, voucher, metering directive, or
subscription model is present yet.

### Go

Go currently has charge intent types in `go/protocol/intents/charge.go`.

No Go `SessionRequest`, `SessionAction`, voucher, metering directive, or
subscription model is present yet.

### Lua

Lua currently has charge intent helpers in
`lua/mpp/protocol/intents/charge.lua` and generic intent-name helpers in
`lua/mpp/protocol/core/types.lua`.

Lua is server-side only for the near-term MPP roadmap. No Lua session or
subscription server model is present yet.

### Ruby and PHP

Ruby and PHP package directories are not present in this checkout.

PHP is expected to be server-side only when it is added. Ruby support remains
unclear until a package layout exists.

## Session Model Observed in TypeScript and Rust

The common session vocabulary already visible in TypeScript and Rust is:

- intent: `session`
- method: `solana`
- funding modes: `push`, `pull`
- pull voucher strategies: `clientVoucher`, `operatedVoucher`
- request cap: `cap`
- currency and optional decimals: `currency`, `decimals`
- server/operator identity: `operator`
- primary recipient: `recipient`
- optional splits: `splits`
- optional minimum voucher increment: `minVoucherDelta`
- optional payment-channel program: `programId`
- optional server blockhash hint: `recentBlockhash`
- actions: `open`, `voucher`, `commit`, `topUp`, `close`
- voucher data: `channelId`, `cumulativeAmount`, `expiresAt`, optional `nonce`
- metering directives: `sessionId`, `deliveryId`, `amount`, `currency`,
  `sequence`, `expiresAt`, optional `commitUrl`, optional `proof`
- commit receipts: `sessionId`, `deliveryId`, `amount`, `cumulative`, `status`

Both implementations treat vouchers as cumulative authorization rather than
per-call independent payments.

The related Pay work points in the same direction: voucher amounts are
cumulative watermarks, not deltas. An `open` action should not carry the first
voucher; voucher and commit actions happen after the session is open.

## Field Mapping To Resolve

Before implementing another language, compare the current SDK field names with
the active Pay/spec direction:

| Concept | Current mpp-sdk names | Pay/spec names to verify |
| --- | --- | --- |
| Spend cap | `cap` | `amount` |
| Suggested deposit | not distinct in the current request | `suggestedDeposit` |
| Minimum deposit | not distinct in the current request | `minimumDeposit` |
| Channel program | `programId` | `channelProgram` |
| Distribution splits | `splits` | `distributionSplits` |
| Grace period | `gracePeriod` | `gracePeriodSeconds` |

This table is a review checklist, not a requested rename. Any rename should come
from the spec or maintainer direction, not from an individual language port.

## Subscription Status

No `subscription` intent implementation or schema appears in this checkout.

The active subscription spec work points to a distinct MPP intent rather than a
thin alias for session:

- intent: `subscription`
- required shared request fields: `amount`, `currency`, `periodUnit`,
  `periodCount`
- optional shared request fields: `recipient`, `subscriptionExpires`,
  `description`, `externalId`, `methodDetails`
- period units: `day`, `week`, `month`, with methods required to reject periods
  they cannot represent exactly
- activation includes the first billing-period charge
- renewal permits at most one charge per billing period
- missed periods do not accumulate extra charge authority
- activation and renewal require durable server accounting and idempotency
- successful activation and renewal receipts include a `subscriptionId`
- possession of a `subscriptionId` alone is not sufficient authorization

Stripe and Tempo profiles are currently specified. No Solana-specific
subscription profile appears in this checkout or in the inspected open spec PRs.

That means Solana SDK work should start with shared subscription request and
state modeling, not Solana transaction construction. A Solana-specific
implementation needs maintainer/spec direction for the recurring authorization
primitive before it can safely move beyond schema and server accounting tests.

## Interop Harness Status

The process interop harness currently models a single charge scenario:

- `tests/interop/src/contracts.ts` has `intent: "charge"`
- `tests/interop/README.md` describes charge-only protected resources
- client adapters pay a protected URL and emit one result message
- server adapters expose a charge-protected resource and emit one ready message

The harness does not yet model session lifecycle, streamed/metered delivery,
voucher commit, top-up, close, or subscription recurrence.

The first session interop fixture should stay small and deterministic:

1. parse a `session` challenge
2. send an `open` action without a voucher
3. send a `voucher` or `commit` action with a cumulative voucher
4. reject non-monotonic cumulative amounts
5. close or finalize the session

Useful negative fixtures include wrong signer, missing or invalid `channelId`,
cumulative decrease, cumulative amount above cap/deposit, and voucher after
close.

## Near-Term Implementation Order

1. Keep charge interop stable before adding another intent.
2. Add session protocol types to Python and Go from the shared TypeScript/Rust
   vocabulary.
3. Add focused unit tests for serialization, parsing, voucher bytes, and
   request/action validation before wiring interop.
4. Add server-side session models for Lua only after TypeScript/Rust behavior is
   stable enough to compare against.
5. Add shared subscription request/state types and validation tests separately
   from session.
6. Defer Solana subscription settlement behavior until a Solana method profile
   exists or maintainers confirm which recurring authorization primitive to use.
7. Defer PHP until its package layout and server-only boundary are present.

## Open Questions

- Should TypeScript server exports include a `solana.session` server method, or
  is Rust currently the only server-side session source of truth?
- Should omitted `modes` always mean push-only across all languages?
- Is `clientVoucher` the first pull-mode strategy other SDKs should implement?
- Should Solana subscription use a new Solana method profile, or should it be
  implemented only for Stripe/Tempo-style methods in this SDK family?
- Which recurring Solana authorization primitive, if any, should back
  subscription renewal charges?
- Should shared subscription schemas land before any language-specific
  settlement behavior?
- Which session flow should the first interop fixture cover: push payment
  channel, pull client voucher, or operated voucher?
