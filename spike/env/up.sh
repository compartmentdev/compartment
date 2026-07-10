#!/usr/bin/env bash
set -euo pipefail

readonly TRACK_ID="${1:-}"
if [[ -z "${TRACK_ID}" ]]; then
  echo "Usage: $0 <track-id>" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=spike/env/common.sh
source "${SCRIPT_DIR}/common.sh"

validate_track_id "${TRACK_ID}"
"${SCRIPT_DIR}/doctor.sh"

readonly CLUSTER_NAME="cpt-${TRACK_ID}"
reservation_active=false
cluster_created=false

cleanup_failed_up() {
  trap - ERR INT TERM
  release_resource_lock
  if [[ "${cluster_created}" == true ]]; then
    k3d cluster delete "${CLUSTER_NAME}" >/dev/null 2>&1 || true
  fi
  if [[ "${reservation_active}" == true ]]; then
    acquire_resource_lock
    release_reservation "${TRACK_ID}"
    release_resource_lock
  fi
}
trap cleanup_failed_up ERR INT TERM

acquire_resource_lock
read -r HOST_HTTP_PORT HOST_HTTPS_PORT < <(reserve_ports "${TRACK_ID}" k3d)
reservation_active=true
prepare_track_images "${TRACK_ID}"
release_resource_lock

k3d cluster create "${CLUSTER_NAME}" \
  --k3s-arg '--disable=traefik@server:*' \
  --port "127.0.0.1:${HOST_HTTP_PORT}:30080@server:0" \
  --port "127.0.0.1:${HOST_HTTPS_PORT}:30443@server:0" \
  --wait
cluster_created=true
import_k3d_images "${CLUSTER_NAME}" "${TRACK_ID}"

readonly CONTEXT="k3d-${CLUSTER_NAME}"
kubectl --context "${CONTEXT}" create namespace compartment --dry-run=client -o yaml | kubectl --context "${CONTEXT}" apply -f -
helm upgrade --install compartment "${CHART_DIR}" \
  --kube-context "${CONTEXT}" \
  --namespace compartment \
  --set ports.http="${HOST_HTTP_PORT}" \
  --set ports.https="${HOST_HTTPS_PORT}" \
  --set images.api.tag="spike-${TRACK_ID}" \
  --set images.worker.tag="spike-${TRACK_ID}" \
  --set images.edge.tag="spike-${TRACK_ID}" \
  --set images.caddy.tag="spike-${TRACK_ID}" \
  --rollback-on-failure \
  --wait \
  --timeout 8m
kubectl --context "${CONTEXT}" --namespace compartment wait deployment --all --for=condition=Available --timeout=2m

reservation_active=false
trap - ERR INT TERM

echo
echo "context: ${CONTEXT}"
echo "console: http://console.localhost:${HOST_HTTP_PORT}"
echo "app wildcard: http://<app>.localhost:${HOST_HTTP_PORT}"
