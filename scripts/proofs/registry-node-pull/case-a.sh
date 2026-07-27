#!/usr/bin/env bash
set -Eeuo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

CLUSTER_NAME="proof-registry-a"
CASE_DIR="${EVIDENCE_DIR}/case-a"
WORK_DIR="$(mktemp -d)"

cleanup() {
  delete_cluster "${CLUSTER_NAME}"
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

require_tools
delete_cluster "${CLUSTER_NAME}"
rm -rf "${CASE_DIR}"
mkdir -p "${CASE_DIR}"

log 'CASE A: creating one-server, two-agent cluster'
k3d cluster create "${CLUSTER_NAME}" --servers 1 --agents 2 --no-lb \
  --kubeconfig-update-default=false --kubeconfig-switch-context=false
k3d kubeconfig get "${CLUSTER_NAME}" >"${WORK_DIR}/kubeconfig"
export KUBECONFIG="${WORK_DIR}/kubeconfig"
wait_for_cluster
assert_exact_nodes "${CLUSTER_NAME}" \
  "k3d-${CLUSTER_NAME}-agent-0" \
  "k3d-${CLUSTER_NAME}-agent-1" \
  "k3d-${CLUSTER_NAME}-server-0"
capture_environment "${CASE_DIR}/environment.txt"
install_registry "${WORK_DIR}"
printf 'HOST=%s\nCLUSTER_IP=%s\n' "${REGISTRY_HOST}" "${REGISTRY_CLUSTER_IP}" >"${CASE_DIR}/endpoint.txt"
capture_service_evidence "${CASE_DIR}/service.txt"
trust_test_ca_on_nodes "${CLUSTER_NAME}" "${WORK_DIR}/ca.crt"
assert_no_runtime_registry_configuration "${CLUSTER_NAME}" "${CASE_DIR}/runtime-registry-config.txt"
capture_node_resolution_and_tls "${CLUSTER_NAME}" "${WORK_DIR}/ca.crt" "${CASE_DIR}/node-dns-tls.txt"
push_unique_image "${CLUSTER_NAME}" "${WORK_DIR}" "case-a-$(date -u +%Y%m%d%H%M%S)"
printf 'IMAGE=%s\n' "${IMAGE_REF}" >>"${CASE_DIR}/endpoint.txt"
pull_on_every_node "${CLUSTER_NAME}" "${CASE_DIR}/pods.txt"
capture_registry_pull_logs "${CASE_DIR}/registry-logs.txt"
assert_containerd_manifest_requests "${CASE_DIR}/registry-logs.txt" 3
kubectl -n "${REGISTRY_NAMESPACE}" get service "${REGISTRY_SERVICE}" -o jsonpath='{.spec.clusterIP}{"\n"}' \
  >"${CASE_DIR}/cluster-ip-before-upgrade.txt"
kubectl -n "${REGISTRY_NAMESPACE}" get service "${REGISTRY_SERVICE}" \
  -o jsonpath='MARKER_BEFORE={.metadata.annotations.proof\.example/helm-marker}{"\n"}' \
  >"${CASE_DIR}/helm-upgrade.txt"
grep -Fq 'MARKER_BEFORE=install' "${CASE_DIR}/helm-upgrade.txt"
helm upgrade registry-proof "${REGISTRY_CHART_DIR}" --namespace "${REGISTRY_NAMESPACE}" \
  --set marker=upgrade
kubectl -n "${REGISTRY_NAMESPACE}" get service "${REGISTRY_SERVICE}" -o jsonpath='{.spec.clusterIP}{"\n"}' \
  >"${CASE_DIR}/cluster-ip-after-upgrade.txt"
diff -u "${CASE_DIR}/cluster-ip-before-upgrade.txt" "${CASE_DIR}/cluster-ip-after-upgrade.txt"
{
  kubectl -n "${REGISTRY_NAMESPACE}" get service "${REGISTRY_SERVICE}" \
    -o jsonpath='MARKER_AFTER={.metadata.annotations.proof\.example/helm-marker}{"\n"}'
  helm -n "${REGISTRY_NAMESPACE}" history registry-proof
} >>"${CASE_DIR}/helm-upgrade.txt"
grep -Fq 'MARKER_AFTER=upgrade' "${CASE_DIR}/helm-upgrade.txt"
printf 'VERDICT=PASS\nNODES=3/3\n' >"${CASE_DIR}/verdict.txt"

log "CASE A PASS: ${IMAGE_REF} is Running after an Always pull on every node"
