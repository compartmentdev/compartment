#!/usr/bin/env bash

PROXY_PID=""
PROXY_LOG=""
PROXY_PORT=""

start_kube_proxy() {
  local context="$1"
  PROXY_LOG="$(mktemp)"
  kubectl --context "${context}" proxy --port=0 >"${PROXY_LOG}" 2>&1 &
  PROXY_PID=$!

  for _ in $(seq 1 50); do
    if grep -q 'Starting to serve on' "${PROXY_LOG}"; then
      PROXY_PORT="$(sed -nE 's/.*:([0-9]+)$/\1/p' "${PROXY_LOG}" | tail -1)"
      export PROXY_PORT
      return 0
    fi
    if ! kill -0 "${PROXY_PID}" 2>/dev/null; then
      cat "${PROXY_LOG}" >&2
      return 1
    fi
    sleep 0.1
  done

  echo "kubectl proxy did not become ready" >&2
  return 1
}

stop_kube_proxy() {
  if [[ -n "${PROXY_PID}" ]]; then
    kill "${PROXY_PID}" 2>/dev/null || true
    wait "${PROXY_PID}" 2>/dev/null || true
  fi
  if [[ -n "${PROXY_LOG}" ]]; then
    rm -f "${PROXY_LOG}"
  fi
}

