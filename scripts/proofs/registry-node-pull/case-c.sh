#!/usr/bin/env bash
set -Eeuo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

CLUSTER_NAME="proof-registry-c"
CASE_DIR="${EVIDENCE_DIR}/case-c"
WORK_DIR="$(mktemp -d)"
CILIUM_VERSION="${CILIUM_VERSION:-1.19.6}"

cleanup() {
  delete_cluster "${CLUSTER_NAME}"
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

require_tools
command -v helm >/dev/null || {
  printf 'Required tool is missing: helm\n' >&2
  exit 1
}
delete_cluster "${CLUSTER_NAME}"
rm -rf "${CASE_DIR}"
mkdir -p "${CASE_DIR}"

log 'CASE C: creating kube-proxy-less, flannel-less cluster'
k3d cluster create "${CLUSTER_NAME}" --servers 1 --agents 0 --no-lb \
  --kubeconfig-update-default=false --kubeconfig-switch-context=false \
  --k3s-arg '--disable-kube-proxy@server:*' \
  --k3s-arg '--flannel-backend=none@server:*' \
  --k3s-arg '--disable-network-policy@server:*' \
  --k3s-arg '--disable=traefik@server:*'
k3d kubeconfig get "${CLUSTER_NAME}" >"${WORK_DIR}/kubeconfig"
export KUBECONFIG="${WORK_DIR}/kubeconfig"

SERVER_NODE="k3d-${CLUSTER_NAME}-server-0"
for _ in $(seq 1 180); do
  if kubectl get node "${SERVER_NODE}" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
kubectl get node "${SERVER_NODE}" >/dev/null
API_HOST="$(docker inspect "${SERVER_NODE}" --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')"
helm repo add cilium https://helm.cilium.io/ >/dev/null 2>&1 || true
helm repo update cilium >/dev/null
helm upgrade --install cilium cilium/cilium --version "${CILIUM_VERSION}" \
  --namespace kube-system \
  --set kubeProxyReplacement=true \
  --set socketLB.enabled=true \
  --set k8sServiceHost="${API_HOST}" \
  --set k8sServicePort=6443
kubectl -n kube-system rollout status daemonset/cilium --timeout=300s
wait_for_cluster
assert_exact_nodes "${CLUSTER_NAME}" "k3d-${CLUSTER_NAME}-server-0"
capture_environment "${CASE_DIR}/environment.txt"
{
  helm -n kube-system get values cilium
  kubectl -n kube-system exec daemonset/cilium -- cilium-dbg status --verbose
} >"${CASE_DIR}/cilium-status.txt"
{
  docker exec "${SERVER_NODE}" mount | grep cgroup2 || true
  kubectl -n kube-system exec daemonset/cilium -- \
    bpftool cgroup tree /run/cilium/cgroupv2 2>&1 || true
} >"${CASE_DIR}/cilium-cgroup-attachments.txt"
if kubectl -n kube-system get daemonset kube-proxy >/dev/null 2>&1; then
  printf 'kube-proxy unexpectedly exists\n' >&2
  exit 1
fi
printf 'kube-proxy daemonset: ABSENT\n' >"${CASE_DIR}/kube-proxy.txt"

install_registry "${WORK_DIR}"
printf 'HOST=%s\nCLUSTER_IP=%s\nCILIUM_VERSION=%s\n' \
  "${REGISTRY_HOST}" "${REGISTRY_CLUSTER_IP}" "${CILIUM_VERSION}" >"${CASE_DIR}/endpoint.txt"
capture_service_evidence "${CASE_DIR}/service.txt"
trust_test_ca_on_nodes "${CLUSTER_NAME}" "${WORK_DIR}/ca.crt"
assert_no_runtime_registry_configuration "${CLUSTER_NAME}" "${CASE_DIR}/runtime-registry-config.txt"

set +e
capture_node_resolution_and_tls "${CLUSTER_NAME}" "${WORK_DIR}/ca.crt" "${CASE_DIR}/node-dns-tls.txt"
HOST_CLUSTER_IP_STATUS=$?
set -e
printf 'HOST_TO_CLUSTER_IP_STATUS=%s\n' "${HOST_CLUSTER_IP_STATUS}" >"${CASE_DIR}/host-reachability-status.txt"

push_unique_image_from_pod "${WORK_DIR}" "case-c-$(date -u +%Y%m%d%H%M%S)"
printf 'IMAGE=%s\n' "${IMAGE_REF}" >>"${CASE_DIR}/endpoint.txt"
NODE_NAME="k3d-${CLUSTER_NAME}-server-0"
kubectl -n "${REGISTRY_NAMESPACE}" apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: pull-${NODE_NAME}
spec:
  restartPolicy: Never
  nodeSelector:
    kubernetes.io/hostname: ${NODE_NAME}
  containers:
    - name: proof
      image: ${IMAGE_REF}
      imagePullPolicy: Always
      command: ["/bin/sh", "-c", "sleep 600"]
EOF
for _ in $(seq 1 30); do
  PULL_REASON="$(kubectl -n "${REGISTRY_NAMESPACE}" get pod "pull-${NODE_NAME}" \
    -o jsonpath='{.status.containerStatuses[0].state.waiting.reason}' 2>/dev/null || true)"
  PULL_PHASE="$(kubectl -n "${REGISTRY_NAMESPACE}" get pod "pull-${NODE_NAME}" \
    -o jsonpath='{.status.phase}' 2>/dev/null || true)"
  if [[ "${PULL_PHASE}" == 'Running' || "${PULL_REASON}" == 'ErrImagePull' || "${PULL_REASON}" == 'ImagePullBackOff' ]]; then
    break
  fi
  sleep 2
done
{
  kubectl -n "${REGISTRY_NAMESPACE}" get pods -o wide
  kubectl -n "${REGISTRY_NAMESPACE}" describe pod "pull-${NODE_NAME}"
} >"${CASE_DIR}/pods-baseline.txt"
kubectl -n kube-system exec daemonset/cilium -- cilium-dbg service list \
  >"${CASE_DIR}/cilium-services.txt" 2>&1 || true
capture_registry_pull_logs "${CASE_DIR}/registry-logs.txt"

if [[ "${PULL_PHASE}" == 'Running' ]]; then
  assert_containerd_manifest_requests "${CASE_DIR}/registry-logs.txt" 1
  printf 'VERDICT=PASS\n' >"${CASE_DIR}/verdict.txt"
  log 'CASE C PASS: kubelet pulled through the Cilium-managed ClusterIP without kube-proxy'
elif [[ "${PULL_REASON}" == 'ErrImagePull' || "${PULL_REASON}" == 'ImagePullBackOff' ]]; then
  log 'CASE C: baseline failed; testing bpf.lbExternalClusterIP mitigation'
  helm upgrade cilium cilium/cilium --version "${CILIUM_VERSION}" \
    --namespace kube-system --reuse-values --set bpf.lbExternalClusterIP=true
  kubectl -n kube-system rollout status daemonset/cilium --timeout=300s
  {
    helm -n kube-system get values cilium
    kubectl -n kube-system get configmap cilium-config -o yaml
    kubectl -n kube-system exec daemonset/cilium -- cilium-dbg config
    kubectl -n kube-system exec daemonset/cilium -- cilium-dbg status --verbose
  } >"${CASE_DIR}/cilium-mitigation-status.txt"
  kubectl -n "${REGISTRY_NAMESPACE}" delete pod "pull-${NODE_NAME}"
  kubectl -n "${REGISTRY_NAMESPACE}" apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: pull-${NODE_NAME}
spec:
  restartPolicy: Never
  nodeSelector:
    kubernetes.io/hostname: ${NODE_NAME}
  containers:
    - name: proof
      image: ${IMAGE_REF}
      imagePullPolicy: Always
      command: ["/bin/sh", "-c", "sleep 600"]
EOF
  MITIGATION_PHASE=''
  MITIGATION_REASON=''
  for _ in $(seq 1 30); do
    MITIGATION_REASON="$(kubectl -n "${REGISTRY_NAMESPACE}" get pod "pull-${NODE_NAME}" \
      -o jsonpath='{.status.containerStatuses[0].state.waiting.reason}' 2>/dev/null || true)"
    MITIGATION_PHASE="$(kubectl -n "${REGISTRY_NAMESPACE}" get pod "pull-${NODE_NAME}" \
      -o jsonpath='{.status.phase}' 2>/dev/null || true)"
    if [[ "${MITIGATION_PHASE}" == 'Running' || "${MITIGATION_REASON}" == 'ErrImagePull' || "${MITIGATION_REASON}" == 'ImagePullBackOff' ]]; then
      break
    fi
    sleep 2
  done
  if [[ "${MITIGATION_PHASE}" == 'Running' ]]; then
    kubectl -n "${REGISTRY_NAMESPACE}" get pods -o wide >"${CASE_DIR}/pods-mitigation.txt"
    capture_registry_pull_logs "${CASE_DIR}/registry-logs-mitigation.txt"
    assert_containerd_manifest_requests "${CASE_DIR}/registry-logs-mitigation.txt" 1
    printf 'VERDICT=PASS_WITH_BPF_LB_EXTERNAL_CLUSTER_IP\n' >"${CASE_DIR}/verdict.txt"
    log "CASE C BASELINE FAIL / MITIGATION PASS: host probe status=${HOST_CLUSTER_IP_STATUS}; bpf.lbExternalClusterIP restored kubelet pull"
  else
    {
      kubectl -n "${REGISTRY_NAMESPACE}" get pods -o wide
      kubectl -n "${REGISTRY_NAMESPACE}" describe pod "pull-${NODE_NAME}"
    } >"${CASE_DIR}/pods-mitigation.txt"
    printf 'VERDICT=FAIL\nBASELINE=CONTAINERD_TIMEOUT\nMITIGATION=CONTAINERD_TIMEOUT\n' \
      >"${CASE_DIR}/verdict.txt"
    log "CASE C FAIL: baseline and bpf.lbExternalClusterIP mitigation both failed"
  fi
else
  printf 'Kubelet pull did not reach a terminal observed result: phase=%s reason=%s\n' \
    "${PULL_PHASE}" "${PULL_REASON}" >&2
  exit 1
fi
