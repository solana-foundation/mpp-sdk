#!/usr/bin/env bash
# Build the payment-channels program .so at the pinned SHA and drop it in tests/fixtures.
# Verifies the sha256 against a committed manifest. Pass --bootstrap on a
# trusted toolchain to write the hash file for the first time.
set -euo pipefail

# Pin the Solana / Anza toolchain. Update BOTH here AND in
# .github/workflows/ci.yml together.
REQUIRED_SOLANA_VERSION="3.1.13"

REPO_ROOT="$(git rev-parse --show-toplevel)"
VENDOR_DIR="$REPO_ROOT/rust/src/program/payment_channels"
FIXTURE="$REPO_ROOT/rust/tests/fixtures/payment_channels.so"
HASH_FILE="$VENDOR_DIR/program_binary.sha256"
CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/solana-mpp-sdk/program-repo"

BOOTSTRAP=0
if [[ "${1:-}" == "--bootstrap" ]]; then
  BOOTSTRAP=1
  shift || true
fi

# Extract the resolved payment_channels_client SHA from Cargo.lock via
# `cargo metadata`. Cargo.lock is the single source of truth for the upstream
# commit.
#
# Requires `jq`; ubiquitous on dev machines and preinstalled on GitHub Actions
# ubuntu-latest runners. If absent, the script fails loud.
if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is required to extract the locked payment_channels_client SHA" >&2
  echo "  install via 'brew install jq' (macOS) or 'apt-get install jq' (Debian)" >&2
  exit 2
fi

SHA=$(cargo metadata --format-version 1 --manifest-path "$REPO_ROOT/rust/Cargo.toml" \
      | jq -r '.packages[] | select(.name == "payment_channels_client") | .source' \
      | sed -n 's/.*#\(.*\)$/\1/p')
if [[ -z "$SHA" ]]; then
  echo "ERROR: could not extract payment_channels_client SHA from Cargo.lock" >&2
  echo "  Run 'cargo update -p payment_channels_client' in rust/ first." >&2
  exit 2
fi

# Toolchain sanity check, fail if invoker is not on the pinned version.
# CI runs `solana-install init $REQUIRED_SOLANA_VERSION` in the workflow.
ACTUAL_SOLANA="$(solana --version 2>/dev/null | awk '{print $2}' || echo 'unknown')"
if [[ "$ACTUAL_SOLANA" != "$REQUIRED_SOLANA_VERSION" ]]; then
  echo "ERROR: expected Solana $REQUIRED_SOLANA_VERSION, got $ACTUAL_SOLANA" >&2
  echo "  run: solana-install init $REQUIRED_SOLANA_VERSION" >&2
  exit 2
fi

mkdir -p "$(dirname "$FIXTURE")"
mkdir -p "$CACHE_DIR"

if [[ ! -d "$CACHE_DIR/.git" ]]; then
  git clone --quiet https://github.com/Moonsong-Labs/solana-payment-channels.git "$CACHE_DIR"
fi

git -C "$CACHE_DIR" fetch --quiet origin
git -C "$CACHE_DIR" checkout --quiet "$SHA"

SBF_OUT="$(mktemp -d)"
trap 'rm -rf "$SBF_OUT"' EXIT
( cd "$CACHE_DIR/program/payment_channels" && cargo build-sbf --sbf-out-dir "$SBF_OUT" )
cp "$SBF_OUT/payment_channels.so" "$FIXTURE"

ACTUAL="$(shasum -a 256 "$FIXTURE" | awk '{print $1}')"
EXPECTED="$(cat "$HASH_FILE" 2>/dev/null || echo '')"
EXPECTED_HASH="${EXPECTED%% *}"

if [[ -z "$EXPECTED" ]]; then
  if [[ "$BOOTSTRAP" -ne 1 ]]; then
    echo "ERROR: $HASH_FILE is empty." >&2
    echo "  The binary hash has never been recorded. If you are the maintainer" >&2
    echo "  running on the pinned Solana $REQUIRED_SOLANA_VERSION toolchain," >&2
    echo "  re-run with: ./scripts/fetch-program-binary.sh --bootstrap" >&2
    echo "  (or: just fetch-program-binary-bootstrap)" >&2
    echo "  See rust/src/program/payment_channels/README.md for the full" >&2
    echo "  bootstrap procedure." >&2
    exit 3
  fi
  echo "[BOOTSTRAP] writing hash for $FIXTURE"
  echo "$ACTUAL  payment_channels.so" > "$HASH_FILE"
elif [[ "$ACTUAL" != "$EXPECTED_HASH" ]]; then
  echo "BINARY HASH MISMATCH" >&2
  echo "  expected: $EXPECTED_HASH" >&2
  echo "  actual:   $ACTUAL  payment_channels.so" >&2
  echo "Update program_binary.sha256 via --bootstrap if intentional (toolchain bump)." >&2
  exit 1
fi

echo "program binary OK: $FIXTURE ($ACTUAL)"
