#!/usr/bin/env bash
set -euo pipefail

readonly CONTEXT="${1:-}"
readonly DURATION_SECONDS="${2:-60}"
readonly TARGET_RPS="${3:-200}"
readonly KILL_AFTER_SECONDS="${4:-0}"

if [[ -z "${CONTEXT}" \
  || ! "${DURATION_SECONDS}" =~ ^[1-9][0-9]*$ \
  || ! "${TARGET_RPS}" =~ ^[1-9][0-9]*$ \
  || ! "${KILL_AFTER_SECONDS}" =~ ^[0-9]+$ \
  || ("${KILL_AFTER_SECONDS}" -gt 0 && "${KILL_AFTER_SECONDS}" -ge "${DURATION_SECONDS}") ]]; then
  echo "Usage: $0 <context> [duration-seconds] [rps] [kill-after-seconds]" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/e2e/bench/common.sh
source "${SCRIPT_DIR}/common.sh"
csv_file=""
latencies_file=""
killer_pid=""

cleanup() {
  if [[ -n "${killer_pid}" ]] && kill -0 "${killer_pid}" 2>/dev/null; then
    kill "${killer_pid}" 2>/dev/null || true
    wait "${killer_pid}" 2>/dev/null || true
  fi
  rm -f "${csv_file}" "${latencies_file}"
  stop_kube_proxy
}
trap cleanup EXIT INT TERM
start_kube_proxy "${CONTEXT}"

readonly URL="http://127.0.0.1:${PROXY_PORT}/api/v1/namespaces/compartment-bench/services/http:bench-web:8080/proxy/healthz"
workers=20
if ((TARGET_RPS < workers)); then
  workers="${TARGET_RPS}"
fi
per_worker_qps="$(awk -v rps="${TARGET_RPS}" -v workers="${workers}" 'BEGIN { printf "%.6f", rps / workers }')"
csv_file="$(mktemp)"
latencies_file="$(mktemp)"

if ((KILL_AFTER_SECONDS > 0)); then
  (
    sleep "${KILL_AFTER_SECONDS}"
    printf '%s killing bench-web pod\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >&2
    kubectl --context "${CONTEXT}" --namespace compartment-bench delete pod \
      --selector app=bench-web --wait=false >/dev/null
  ) &
  killer_pid=$!
fi

started_at="$(date +%s)"
set +e
hey -z "${DURATION_SECONDS}s" -c "${workers}" -q "${per_worker_qps}" -o csv "${URL}" >"${csv_file}"
hey_exit=$?
set -e
finished_at="$(date +%s)"
if [[ -n "${killer_pid}" ]]; then
  wait "${killer_pid}" || true
  killer_pid=""
fi

tail -n +2 "${csv_file}" | awk -F, 'NF >= 7 { print $1 }' | sort -n >"${latencies_file}"
responses="$(tail -n +2 "${csv_file}" | awk -F, 'NF >= 7 { count++ } END { print count + 0 }')"
successes="$(tail -n +2 "${csv_file}" | awk -F, '$7 >= 200 && $7 < 400 { count++ } END { print count + 0 }')"
expected=$((DURATION_SECONDS * TARGET_RPS))
http_failures=$((responses - successes))
missing_responses=$((expected - responses))
if ((missing_responses < 0)); then
  missing_responses=0
fi
drops=$((http_failures + missing_responses))
elapsed=$((finished_at - started_at))
if ((elapsed < 1)); then
  elapsed=1
fi

p50=na
p99=na
if ((responses > 0)); then
  p50_index=$(((responses * 50 + 99) / 100))
  p99_index=$(((responses * 99 + 99) / 100))
  p50="$(sed -n "${p50_index}p" "${latencies_file}" | awk '{ printf "%.2f", $1 * 1000 }')"
  p99="$(sed -n "${p99_index}p" "${latencies_file}" | awk '{ printf "%.2f", $1 * 1000 }')"
fi
actual_rps="$(awk -v responses="${responses}" -v elapsed="${elapsed}" 'BEGIN { printf "%.2f", responses / elapsed }')"

printf 'rps=%s p50_ms=%s p99_ms=%s drops=%s http_failures=%s missing_responses=%s responses=%s expected=%s hey_exit=%s\n' \
  "${actual_rps}" "${p50}" "${p99}" "${drops}" "${http_failures}" "${missing_responses}" \
  "${responses}" "${expected}" "${hey_exit}"
