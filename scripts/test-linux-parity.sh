#!/usr/bin/env bash
#
# scripts/test-linux-parity.sh — P143-C Linux Parity Gate
#
# Runs the Jest suite inside a Linux Node 22 container to catch Win32-only
# code paths that local Windows machines mask (LESSONS: v2.2.6 chmodSync mock
# gap, v2.3.0 chmodSync pattern recurring). Provides an isolated KASTELL_DIR
# so state doesn't leak between runs.
#
# Usage:
#   npm run test:linux                # full suite
#   npm run test:linux -- tests/unit/foo.test.ts   # focused subset
#
# Exit codes:
#   0  - all tests passed
#   2  - Docker not found (cannot satisfy Linux parity requirement)
#   3  - docker run failed (mount, network, container image pull)
#   *  - any other exit code is forwarded from Jest inside the container
#
set -e

# ─── Pre-flight: Docker availability ─────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: Docker not found. Linux parity gate requires Docker to run Linux Node 22." >&2
  echo "       Install Docker Desktop (Windows/macOS) or docker.io (Linux) and retry." >&2
  echo "       Alternatively run on a Linux host or WSL2 directly." >&2
  exit 2
fi

# ─── Isolated temp state ─────────────────────────────────────────────────────
export KASTELL_DIR="$(mktemp -d)"
trap "rm -rf \"$KASTELL_DIR\"" EXIT

# ─── Print exact command for transparency ────────────────────────────────────
echo "Running: npx jest --runInBand --config jest.config.cjs $*"
echo "KASTELL_DIR=$KASTELL_DIR"

# ─── Run Jest in Linux container ────────────────────────────────────────────
MSYS_NO_PATHCONV=1 docker run --rm \
  -v "$PWD":/app \
  -w /app \
  -e KASTELL_DIR \
  -e CI=1 \
  node:22-alpine \
  sh -c "apk add --no-cache libc6-compat openssh-client >/dev/null 2>&1; npx --yes jest --runInBand --config jest.config.cjs $*"
