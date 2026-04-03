set shell := ["bash", "-uc"]

default:
    @just --list

# ── TypeScript ──

# Install TypeScript dependencies
ts-install:
    cd typescript && pnpm install

# Build TypeScript packages
ts-build:
    cd typescript && pnpm build

# Typecheck TypeScript
ts-typecheck:
    cd typescript && pnpm typecheck

# Unit tests (TypeScript)
ts-test:
    cd typescript && pnpm test

# Integration tests (TypeScript, requires Surfpool)
ts-test-integration:
    cd typescript && pnpm test:integration

# Format and lint TypeScript
ts-fmt:
    cd typescript && pnpm lint:fix && pnpm format

# Audit TypeScript dependencies
ts-audit:
    cd typescript && pnpm audit --production

# ── Rust ──

# Build Rust crate
rs-build:
    cd rust && cargo build

# Test Rust crate
rs-test:
    cd rust && cargo test

# Format Rust
rs-fmt:
    cd rust && cargo fmt

# Lint Rust
rs-lint:
    cd rust && cargo clippy -- -D warnings

# ── Go ──

# Build Go SDK
go-build:
    mkdir -p /tmp/go-build-cache
    cd go && GOCACHE=/tmp/go-build-cache go build ./...

# Test Go SDK
go-test:
    mkdir -p /tmp/go-build-cache
    cd go && GOCACHE=/tmp/go-build-cache go test ./...

# Format Go SDK
go-fmt:
    cd go && gofmt -w $$(find . -name '*.go' -type f | sort)

# Run Go coverage with a minimum threshold of 70%
go-test-cover:
    mkdir -p /tmp/go-build-cache
    cd go && GOCACHE=/tmp/go-build-cache go test ./... -coverprofile=coverage.out -covermode=atomic
    cd go && GOCACHE=/tmp/go-build-cache ./scripts/check_coverage.sh coverage.out 70

# ── Orchestration ──

# Build everything
build: ts-build rs-build go-build

# Run all unit tests
test: ts-test rs-test go-test

# Run all tests including integration
test-all: ts-test ts-test-integration rs-test go-test-cover

# Format everything
fmt: ts-fmt rs-fmt go-fmt

# Pre-commit checks
pre-commit: ts-audit ts-fmt ts-typecheck ts-test rs-fmt rs-lint rs-test go-fmt go-test-cover
