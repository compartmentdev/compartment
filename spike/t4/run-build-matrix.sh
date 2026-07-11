#!/usr/bin/env bash
set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly RUNTIME_SCRIPT="${SCRIPT_DIR}/.build-matrix.runtime.ts"
trap 'rm -f "${RUNTIME_SCRIPT}"' EXIT
cp "${SCRIPT_DIR}/build-matrix.ts.in" "${RUNTIME_SCRIPT}"
pnpm exec tsx "${RUNTIME_SCRIPT}" "$@"
