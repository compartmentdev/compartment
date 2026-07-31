#!/usr/bin/env bash
set -euo pipefail

readonly TRACK_ID="${1:-}"
if [[ -z "${TRACK_ID}" ]]; then
  echo "Usage: $0 <track-id>" >&2
  echo "STATUS=failed"
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=spike/env/common.sh
source "${SCRIPT_DIR}/common.sh"

readonly CLUSTER_NAME="cpt-${TRACK_ID}"
readonly CLUSTER_OWNER="$$-${RANDOM}-${RANDOM}"
reservation_active=false
cluster_creation_started=false
run_status=failed

cleanup_failed_up() {
  local cleanup_status=0
  release_resource_lock
  if [[ "${cluster_creation_started}" == true ]]; then
    remove_k3d_cluster_resources "${CLUSTER_NAME}" || cleanup_status=1
  fi
  if [[ "${reservation_active}" == true && "${cleanup_status}" == 0 ]]; then
    acquire_resource_lock
    release_reservation "${TRACK_ID}"
    release_resource_lock
    reservation_active=false
  elif [[ "${reservation_active}" == true ]]; then
    echo "Reservation retained for ${TRACK_ID}; run down.sh after Docker recovers." >&2
  fi
  return "${cleanup_status}"
}

finish_up() {
  local exit_status=$?
  trap - EXIT INT TERM
  if [[ "${run_status}" == ok ]]; then
    echo "STATUS=ok"
    exit 0
  fi
  cleanup_failed_up || exit_status=1
  echo "STATUS=failed"
  if ((exit_status == 0)); then
    exit_status=1
  fi
  exit "${exit_status}"
}
trap finish_up EXIT
trap 'exit 130' INT TERM

validate_track_id "${TRACK_ID}"
"${SCRIPT_DIR}/doctor.sh"

acquire_resource_lock
if k3d cluster list --no-headers | awk '{print $1}' | grep -Fxq "${CLUSTER_NAME}"; then
  echo "Cluster ${CLUSTER_NAME} already exists." >&2
  release_resource_lock
  exit 1
fi
read -r HOST_HTTP_PORT HOST_HTTPS_PORT < <(reserve_ports "${TRACK_ID}" k3d)
reservation_active=true
prepare_track_images "${TRACK_ID}"
release_resource_lock

cluster_creation_started=true
k3d cluster create "${CLUSTER_NAME}" \
  --runtime-label "compartment.spike.owner=${CLUSTER_OWNER}@server:0" \
  --k3s-arg '--disable=traefik@server:*' \
  --port "127.0.0.1:${HOST_HTTP_PORT}:30080@server:0" \
  --port "127.0.0.1:${HOST_HTTPS_PORT}:30443@server:0" \
  --wait
import_k3d_images "${CLUSTER_NAME}" "${TRACK_ID}"

readonly CONTEXT="k3d-${CLUSTER_NAME}"
kubectl --context "${CONTEXT}" create namespace compartment --dry-run=client -o yaml | kubectl --context "${CONTEXT}" apply -f -
install_platform_with_retry "${CONTEXT}" "${TRACK_ID}" "${HOST_HTTP_PORT}" "${HOST_HTTPS_PORT}"

reservation_active=false
run_status=ok

echo
echo "context: ${CONTEXT}"
echo "console: http://console.localhost:${HOST_HTTP_PORT}"
echo "app wildcard: http://<app>.localhost:${HOST_HTTP_PORT}"
