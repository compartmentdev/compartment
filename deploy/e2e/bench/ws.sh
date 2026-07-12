#!/usr/bin/env bash
set -euo pipefail

readonly CONTEXT="${1:-}"
if [[ -z "${CONTEXT}" ]]; then
  echo "Usage: $0 <context> [connections] [duration-seconds]" >&2
  exit 2
fi
readonly CONNECTIONS="${2:-10}"
readonly DURATION_SECONDS="${3:-60}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/e2e/bench/common.sh
source "${SCRIPT_DIR}/common.sh"
trap stop_kube_proxy EXIT INT TERM
start_kube_proxy "${CONTEXT}"

readonly URL="ws://127.0.0.1:${PROXY_PORT}/api/v1/namespaces/compartment-bench/services/http:bench-ws:8080/proxy/ws"
node --input-type=module - "${URL}" "${CONNECTIONS}" "${DURATION_SECONDS}" <"${SCRIPT_DIR}/ws-client.mjs.in"
