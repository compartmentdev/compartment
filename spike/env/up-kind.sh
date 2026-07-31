#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=spike/env/common.sh
source "${SCRIPT_DIR}/common.sh"

readonly TRACK_ID=kind
readonly CLUSTER_OWNER="$$-${RANDOM}-${RANDOM}"
readonly CLUSTER_NAME="cpt-kind-${CLUSTER_OWNER}"
readonly CONTEXT="kind-${CLUSTER_NAME}"
"${SCRIPT_DIR}/doctor.sh"

reservation_active=false
cluster_creation_started=false
cleanup_failed_up() {
  local cleanup_status=0
  trap - ERR INT TERM
  release_resource_lock
  if [[ "${cluster_creation_started}" == true ]]; then
    remove_kind_cluster_resources "${CLUSTER_NAME}" || cleanup_status=1
  fi
  if [[ "${cleanup_status}" == 0 && "$(cat "${KIND_CLUSTER_FILE}" 2>/dev/null || true)" == "${CLUSTER_NAME}" ]]; then
    rm -f "${KIND_CLUSTER_FILE}"
  fi
  if [[ "${reservation_active}" == true && "${cleanup_status}" == 0 ]]; then
    acquire_resource_lock
    release_reservation "${TRACK_ID}"
    release_resource_lock
  elif [[ "${reservation_active}" == true ]]; then
    echo "Reservation retained for ${TRACK_ID}; run down.sh after Docker recovers." >&2
  fi
  return "${cleanup_status}"
}
trap cleanup_failed_up ERR INT TERM

acquire_resource_lock
if [[ -s "${KIND_CLUSTER_FILE}" ]]; then
  echo "A kind spike cluster is already recorded; run down.sh kind first." >&2
  release_resource_lock
  exit 1
fi
read -r HOST_HTTP_PORT HOST_HTTPS_PORT < <(reserve_ports "${TRACK_ID}" kind)
reservation_active=true
printf '%s\n' "${CLUSTER_NAME}" >"${KIND_CLUSTER_FILE}"
prepare_track_images "${TRACK_ID}"
release_resource_lock

readonly KIND_CONFIG="${STATE_DIR}/kind-${TRACK_ID}.yaml"
sed -e "s/HOST_HTTP_PORT/${HOST_HTTP_PORT}/" \
  -e "s/HOST_HTTPS_PORT/${HOST_HTTPS_PORT}/" \
  "${SPIKE_ENV_DIR}/kind.yaml" >"${KIND_CONFIG}"
cluster_creation_started=true
kind create cluster --name "${CLUSTER_NAME}" --config "${KIND_CONFIG}" --wait 2m
import_kind_images "${CLUSTER_NAME}" "${TRACK_ID}"

kubectl --context "${CONTEXT}" create namespace compartment --dry-run=client -o yaml \
  | kubectl --context "${CONTEXT}" apply -f -
kubectl --context "${CONTEXT}" label namespace compartment \
  pod-security.kubernetes.io/enforce=restricted \
  pod-security.kubernetes.io/audit=restricted \
  pod-security.kubernetes.io/warn=restricted \
  --overwrite
install_platform_with_retry "${CONTEXT}" "${TRACK_ID}" "${HOST_HTTP_PORT}" "${HOST_HTTPS_PORT}" \
  --values "${CHART_DIR}/values-kind.yaml"

reservation_active=false
trap - ERR INT TERM

echo
echo "context: ${CONTEXT}"
echo "PSA: restricted"
echo "console: http://console.localhost:${HOST_HTTP_PORT}"
echo "app wildcard: http://<app>.localhost:${HOST_HTTP_PORT}"
echo "remove: ${SPIKE_ENV_DIR}/down.sh kind"
