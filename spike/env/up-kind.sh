#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=spike/env/common.sh
source "${SCRIPT_DIR}/common.sh"

readonly TRACK_ID=kind
readonly CLUSTER_NAME=cpt-kind
readonly CONTEXT=kind-cpt-kind
"${SCRIPT_DIR}/doctor.sh"

reservation_active=false
cluster_created=false
cleanup_failed_up() {
  trap - ERR INT TERM
  release_resource_lock
  if [[ "${cluster_created}" == true ]]; then
    kind delete cluster --name "${CLUSTER_NAME}" >/dev/null 2>&1 || true
  fi
  if [[ "${reservation_active}" == true ]]; then
    acquire_resource_lock
    release_reservation "${TRACK_ID}"
    release_resource_lock
  fi
}
trap cleanup_failed_up ERR INT TERM

acquire_resource_lock
read -r HOST_HTTP_PORT HOST_HTTPS_PORT < <(reserve_ports "${TRACK_ID}" kind)
reservation_active=true
prepare_track_images "${TRACK_ID}"
release_resource_lock

readonly KIND_CONFIG="${STATE_DIR}/kind-${TRACK_ID}.yaml"
sed -e "s/HOST_HTTP_PORT/${HOST_HTTP_PORT}/" -e "s/HOST_HTTPS_PORT/${HOST_HTTPS_PORT}/" \
  "${SPIKE_ENV_DIR}/kind.yaml" >"${KIND_CONFIG}"
kind create cluster --name "${CLUSTER_NAME}" --config "${KIND_CONFIG}" --wait 2m
cluster_created=true
import_kind_images "${CLUSTER_NAME}" "${TRACK_ID}"

kubectl --context "${CONTEXT}" create namespace compartment --dry-run=client -o yaml \
  | kubectl --context "${CONTEXT}" apply -f -
kubectl --context "${CONTEXT}" label namespace compartment \
  pod-security.kubernetes.io/enforce=restricted \
  pod-security.kubernetes.io/audit=restricted \
  pod-security.kubernetes.io/warn=restricted \
  --overwrite
helm upgrade --install compartment "${CHART_DIR}" \
  --kube-context "${CONTEXT}" \
  --namespace compartment \
  --values "${CHART_DIR}/values-kind.yaml" \
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
echo "PSA: restricted"
echo "console: http://console.localhost:${HOST_HTTP_PORT}"
echo "app wildcard: http://<app>.localhost:${HOST_HTTP_PORT}"
echo "remove: ${SPIKE_ENV_DIR}/down.sh kind"
