# MPP Subscription Fixtures

These fixtures capture the shared `subscription` intent shape from
`tempoxyz/mpp-specs#230` without adding a Solana-specific settlement profile.

The shared subscription intent is intentionally narrow:

- fixed amount per billing period
- activation includes the first billing-period charge
- at most one successful renewal charge per billing period
- missed periods do not accumulate extra charge authority
- durable server accounting is required for idempotency

These examples are safe to use for language-level schema and accounting tests.
They should not be used to claim end-to-end Solana subscription settlement.
