#!/usr/bin/env bash
set -Eeuo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"

CLUSTER_NAME="proof-registry-b"
DNSMASQ_NAME="${CLUSTER_NAME}-dnsmasq"
CASE_DIR="${EVIDENCE_DIR}/case-b"
WORK_DIR="$(mktemp -d)"
ORIGINAL_RESOLV="${WORK_DIR}/resolv.conf"
RESOLV_REPLACED='no'

cleanup() {
  if [[ "${RESOLV_REPLACED}" == 'yes' ]] && docker inspect "${SERVER_NODE:-missing}" >/dev/null 2>&1; then
    docker exec -i "${SERVER_NODE}" sh -c 'cat >/etc/resolv.conf' <"${ORIGINAL_RESOLV}" || true
  fi
  docker rm -f "${DNSMASQ_NAME}" >/dev/null 2>&1 || true
  delete_cluster "${CLUSTER_NAME}"
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

start_dnsmasq() {
  local allow_rebind="$1"
  local dns_ip="$2"
  local extra_args=()
  if [[ "${allow_rebind}" == 'yes' ]]; then
    extra_args+=(--rebind-domain-ok=/sslip.io/)
  fi
  docker rm -f "${DNSMASQ_NAME}" >/dev/null 2>&1 || true
  docker run -d --name "${DNSMASQ_NAME}" --network "k3d-${CLUSTER_NAME}" \
    --ip "${dns_ip}" --cap-add NET_ADMIN andyshinn/dnsmasq:2.83 \
    --no-resolv --server=1.1.1.1 --stop-dns-rebind --log-queries --log-facility=- \
    "${extra_args[@]}" >/dev/null
}

require_tools
delete_cluster "${CLUSTER_NAME}"
docker rm -f "${DNSMASQ_NAME}" >/dev/null 2>&1 || true
rm -rf "${CASE_DIR}"
mkdir -p "${CASE_DIR}"

log 'CASE B: creating cluster and protected dnsmasq resolver'
k3d cluster create "${CLUSTER_NAME}" --servers 1 --agents 0 --no-lb \
  --kubeconfig-update-default=false --kubeconfig-switch-context=false
k3d kubeconfig get "${CLUSTER_NAME}" >"${WORK_DIR}/kubeconfig"
export KUBECONFIG="${WORK_DIR}/kubeconfig"
wait_for_cluster
assert_exact_nodes "${CLUSTER_NAME}" "k3d-${CLUSTER_NAME}-server-0"
capture_environment "${CASE_DIR}/environment.txt"
install_registry "${WORK_DIR}"
trust_test_ca_on_nodes "${CLUSTER_NAME}" "${WORK_DIR}/ca.crt"
assert_no_runtime_registry_configuration "${CLUSTER_NAME}" "${CASE_DIR}/runtime-registry-config.txt"
push_unique_image "${CLUSTER_NAME}" "${WORK_DIR}" "case-b-$(date -u +%Y%m%d%H%M%S)"
printf 'HOST=%s\nCLUSTER_IP=%s\nIMAGE=%s\n' "${REGISTRY_HOST}" "${REGISTRY_CLUSTER_IP}" "${IMAGE_REF}" >"${CASE_DIR}/endpoint.txt"

SERVER_NODE="k3d-${CLUSTER_NAME}-server-0"
DNS_IP="$(docker network inspect "k3d-${CLUSTER_NAME}" --format '{{(index .IPAM.Config 0).Subnet}}' | sed -E 's#^([0-9]+\.[0-9]+\.[0-9]+)\..*$#\1.53#')"
docker cp "${SERVER_NODE}:/etc/resolv.conf" "${ORIGINAL_RESOLV}"
start_dnsmasq no "${DNS_IP}"
printf 'nameserver %s\noptions timeout:2 attempts:1\n' "${DNS_IP}" >"${WORK_DIR}/proof-resolv.conf"
docker exec -i "${SERVER_NODE}" sh -c 'cat >/etc/resolv.conf' <"${WORK_DIR}/proof-resolv.conf"
RESOLV_REPLACED='yes'

docker exec "${SERVER_NODE}" nslookup "${REGISTRY_HOST}" >"${CASE_DIR}/blocked-resolution.txt" 2>&1 || true
docker logs "${DNSMASQ_NAME}" >"${CASE_DIR}/dnsmasq-blocked-logs.txt" 2>&1
grep -Fq "Server:		${DNS_IP}" "${CASE_DIR}/blocked-resolution.txt"
grep -Fq "query[A] ${REGISTRY_HOST}" "${CASE_DIR}/dnsmasq-blocked-logs.txt"
grep -Fq "possible DNS-rebind attack detected: ${REGISTRY_HOST}" "${CASE_DIR}/dnsmasq-blocked-logs.txt"
if grep -Fq "Address: ${REGISTRY_CLUSTER_IP}" "${CASE_DIR}/blocked-resolution.txt"; then
  printf 'Expected dnsmasq rebinding protection to block %s\n' "${REGISTRY_HOST}" >&2
  exit 1
fi

start_dnsmasq yes "${DNS_IP}"
docker exec -i "${SERVER_NODE}" sh -c 'cat >/etc/resolv.conf' <"${WORK_DIR}/proof-resolv.conf"
docker exec "${SERVER_NODE}" nslookup "${REGISTRY_HOST}" >"${CASE_DIR}/allowed-resolution.txt"
grep -Fq "Address: ${REGISTRY_CLUSTER_IP}" "${CASE_DIR}/allowed-resolution.txt"
pull_on_every_node "${CLUSTER_NAME}" "${CASE_DIR}/pods.txt"
docker logs "${DNSMASQ_NAME}" >"${CASE_DIR}/dnsmasq-allowed-logs.txt" 2>&1
grep -Fq "query[A] ${REGISTRY_HOST}" "${CASE_DIR}/dnsmasq-allowed-logs.txt"
if grep -Fq "possible DNS-rebind attack detected: ${REGISTRY_HOST}" "${CASE_DIR}/dnsmasq-allowed-logs.txt"; then
  printf 'Allowlisted dnsmasq still reported a rebinding rejection\n' >&2
  exit 1
fi
capture_registry_pull_logs "${CASE_DIR}/registry-logs.txt"
assert_containerd_manifest_requests "${CASE_DIR}/registry-logs.txt" 1
docker exec -i "${SERVER_NODE}" sh -c 'cat >/etc/resolv.conf' <"${ORIGINAL_RESOLV}"
RESOLV_REPLACED='no'
ORIGINAL_HASH="$(sha256sum "${ORIGINAL_RESOLV}" | awk '{print $1}')"
RESTORED_HASH="$(docker exec "${SERVER_NODE}" sha256sum /etc/resolv.conf | awk '{print $1}')"
printf 'ORIGINAL_SHA256=%s\nRESTORED_SHA256=%s\n' \
  "${ORIGINAL_HASH}" "${RESTORED_HASH}" >"${CASE_DIR}/resolver-restoration.txt"
[[ "${ORIGINAL_HASH}" == "${RESTORED_HASH}" ]]
printf 'VERDICT=PASS_WITH_ALLOWLIST\n' >"${CASE_DIR}/verdict.txt"

log 'CASE B PASS: stop-dns-rebind blocked the private answer; the explicit sslip.io allowlist restored the pull'
