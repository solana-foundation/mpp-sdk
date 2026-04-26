# payment_channels boundary

Files in this directory are all SDK-owned: `voucher.rs`, `ed25519.rs`,
`state.rs`, `ix.rs`, `verify.rs`, `splits_ext.rs` implement the three byte
contracts the program speaks (the 48-byte signed voucher payload, the
160-byte ed25519 precompile instruction, and the Channel PDA derivation).
The Codama-generated Rust client lives upstream as the
`payment_channels_client` crate and is pulled in as a git dependency (see
`rust/Cargo.toml`), not vendored here.

## Program binary hash, one-time bootstrap

`program_binary.sha256` pins the sha256 of the built `.so` that the L1
integration oracle loads into litesvm. The first maintainer to build at a new
upstream SHA records it via `--bootstrap`; every subsequent build (local dev,
CI) verifies against that recorded hash. This defense exists because an
implicit "first build wins" bootstrap blesses whatever toolchain the first
builder happened to have installed, which is a silent supply-chain weakness.

### Prerequisites

- Anza / Solana toolchain pinned to `REQUIRED_SOLANA_VERSION` in
  `scripts/fetch-program-binary.sh`. Run `solana-install init $VERSION`.
- Clean working tree on a trusted host.

### Procedure

```bash
# 1. Bump the upstream pin in rust/Cargo.toml and refresh the lockfile.
#    `cargo update -p payment_channels_client` records the resolved SHA in
#    Cargo.lock. `fetch-program-binary.sh` reads that SHA directly via
#    `cargo metadata`; no separate text-file mirror to keep in sync.
cargo update -p payment_channels_client

# 2. Build the .so at that SHA and record the hash.
just fetch-program-binary-bootstrap      # build + record hash (first time only)
git add rust/src/program/payment_channels/program_binary.sha256
git commit -m "chore: :wrench: record program_binary.sha256 at <SHA>"
```

### Subsequent builds

```bash
just fetch-program-binary   # build + verify against committed hash
just verify-binary-hash     # verify only (no rebuild)
```

A hash mismatch is a hard failure. If it is intentional (toolchain bump),
re-run with `--bootstrap` and document the reason in the commit message.
