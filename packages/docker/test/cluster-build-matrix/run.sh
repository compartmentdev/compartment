#!/usr/bin/env bash
set -euo pipefail

context="${1:?usage: $0 <kube-context> <build-namespace> <results-directory>}"
namespace="${2:?}"
results="${3:?}"
dir="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "${dir}/../../../.." && pwd)"
runtime="${dir}/.build-matrix.runtime.ts"
scratch="$(mktemp -d)"
monitor_pid=''

cleanup() {
  if [[ -n "${monitor_pid}" ]]; then kill "${monitor_pid}" >/dev/null 2>&1 || true; fi
  rm -f "${runtime}"
  rm -rf "${scratch}"
}
trap cleanup EXIT

fail() { echo "$1" >&2; exit 1; }
kube() { kubectl --context "${context}" "$@"; }

required_env=(
  BUILDKIT_ADDR
  CLUSTER_BUILD_FAILURE_MAX_SECONDS
  CLUSTER_BUILD_PRIVATE_PROBE_IP
  CLUSTER_BUILD_REGISTRY
  CLUSTER_BUILD_REGISTRY_API_URL
  CLUSTER_BUILD_REGISTRY_INSECURE
  CLUSTER_BUILD_REGISTRY_PASSWORD
  CLUSTER_BUILD_REGISTRY_USERNAME
  CLUSTER_BUILD_SELECTED_WORKER_NAMESPACE
  CLUSTER_BUILD_SELECTED_WORKER_POD
  CLUSTER_BUILD_UNSELECTED_NAMESPACE
  CLUSTER_BUILD_UNSELECTED_NAMESPACE_POD
  CLUSTER_BUILD_UNSELECTED_WORKER_POD
)
for name in "${required_env[@]}"; do
  [[ -n "${!name:-}" ]] || fail "${name} is required"
done
for command in curl jq kubectl pnpm; do
  command -v "${command}" >/dev/null || fail "${command} is required"
done
[[ "${CLUSTER_BUILD_REGISTRY_INSECURE}" == 'true' || "${CLUSTER_BUILD_REGISTRY_INSECURE}" == 'false' ]] || fail 'CLUSTER_BUILD_REGISTRY_INSECURE must be true or false'
[[ "${CLUSTER_BUILD_FAILURE_MAX_SECONDS}" =~ ^[1-9][0-9]*$ ]] || fail 'CLUSTER_BUILD_FAILURE_MAX_SECONDS must be a positive integer'
[[ "${CLUSTER_BUILD_REGISTRY_API_URL}" == http://* || "${CLUSTER_BUILD_REGISTRY_API_URL}" == https://* ]] || fail 'CLUSTER_BUILD_REGISTRY_API_URL must include http:// or https://'
awk -F. 'NF == 4 {for (i=1;i<=4;i++) if ($i !~ /^[0-9]+$/ || $i < 0 || $i > 255) exit 1; if ($1 == 10 || ($1 == 172 && $2 >= 16 && $2 <= 31) || ($1 == 192 && $2 == 168)) exit 0} {exit 1}' <<<"${CLUSTER_BUILD_PRIVATE_PROBE_IP}" || fail 'CLUSTER_BUILD_PRIVATE_PROBE_IP must be an RFC1918 IPv4 address'

mkdir -p "${results}"
results="$(cd "${results}" && pwd)"
buildkit_host="buildkit.${namespace}.svc"
registry_host="registry.${namespace}.svc"

wait_for_platform() {
  kube get namespace "${namespace}" >/dev/null
  kube -n "${namespace}" wait deployment/buildkit --for=condition=Available --timeout=180s >/dev/null
  kube -n "${namespace}" wait deployment/registry --for=condition=Available --timeout=180s >/dev/null
}

assert_pvcs_bound() {
  for claim in buildkit-data registry-data; do
    phase="$(kube -n "${namespace}" get pvc "${claim}" -o jsonpath='{.status.phase}')"
    [[ "${phase}" == 'Bound' ]] || fail "${claim} PVC must be Bound"
    storage="$(kube -n "${namespace}" get pvc "${claim}" -o jsonpath='{.spec.resources.requests.storage}')"
    access_mode="$(kube -n "${namespace}" get pvc "${claim}" -o jsonpath='{.spec.accessModes[0]}')"
    [[ "${storage}" == '8Gi' && "${access_mode}" == 'ReadWriteOnce' ]] || fail "${claim} must request 8Gi ReadWriteOnce storage"
  done
}

assert_private_services() {
  for service in buildkit registry; do
    type="$(kube -n "${namespace}" get service "${service}" -o jsonpath='{.spec.type}')"
    [[ "${type}" == 'ClusterIP' ]] || fail "${service} must remain ClusterIP-only"
  done
}

probe_tcp() {
  probe_name="$1" probe_namespace="$2" probe_pod="$3" host="$4" port="$5" expected="$6"
  actual='deny'
  if kube -n "${probe_namespace}" exec "${probe_pod}" -- nc -z -w 3 "${host}" "${port}" >/dev/null 2>&1; then actual='allow'; fi
  printf '%s\t%s\t%s\n' "${probe_name}" "${expected}" "${actual}" >>"${results}/connectivity.tsv"
  [[ "${actual}" == "${expected}" ]] || fail "connectivity probe ${probe_name}: expected ${expected}, got ${actual}"
}

probe_buildkit_egress() {
  probe_name="$1" host="$2" port="$3" expected="$4"
  actual='deny'
  if kube -n "${namespace}" exec deployment/buildkit -c buildkit -- nc -z -w 3 "${host}" "${port}" >/dev/null 2>&1; then actual='allow'; fi
  printf '%s\t%s\t%s\n' "${probe_name}" "${expected}" "${actual}" >>"${results}/connectivity.tsv"
  [[ "${actual}" == "${expected}" ]] || fail "connectivity probe ${probe_name}: expected ${expected}, got ${actual}"
}

run_connectivity_matrix() {
  for target in \
    "${CLUSTER_BUILD_SELECTED_WORKER_NAMESPACE}:${CLUSTER_BUILD_SELECTED_WORKER_POD}" \
    "${CLUSTER_BUILD_SELECTED_WORKER_NAMESPACE}:${CLUSTER_BUILD_UNSELECTED_WORKER_POD}" \
    "${CLUSTER_BUILD_UNSELECTED_NAMESPACE}:${CLUSTER_BUILD_UNSELECTED_NAMESPACE_POD}"; do
    probe_namespace="${target%%:*}" probe_pod="${target#*:}"
    managed_by="$(kube -n "${probe_namespace}" get pod "${probe_pod}" -o jsonpath='{.metadata.labels.app\.kubernetes\.io/managed-by}')"
    [[ "${managed_by}" == 'compartment' ]] || fail "probe pod ${probe_namespace}/${probe_pod} must be cluster-owned"
    kube -n "${probe_namespace}" exec "${probe_pod}" -- sh -c 'command -v nc' >/dev/null || fail "probe pod ${probe_namespace}/${probe_pod} requires nc"
  done
  kube -n "${namespace}" exec deployment/buildkit -c buildkit -- sh -c 'command -v nc' >/dev/null || fail 'BuildKit image requires nc for connectivity evidence'
  : >"${results}/connectivity.tsv"
  probe_tcp worker-to-buildkit "${CLUSTER_BUILD_SELECTED_WORKER_NAMESPACE}" "${CLUSTER_BUILD_SELECTED_WORKER_POD}" "${buildkit_host}" 1234 allow
  probe_tcp wrong-pod-to-buildkit "${CLUSTER_BUILD_SELECTED_WORKER_NAMESPACE}" "${CLUSTER_BUILD_UNSELECTED_WORKER_POD}" "${buildkit_host}" 1234 deny
  probe_tcp wrong-namespace-to-buildkit "${CLUSTER_BUILD_UNSELECTED_NAMESPACE}" "${CLUSTER_BUILD_UNSELECTED_NAMESPACE_POD}" "${buildkit_host}" 1234 deny
  probe_tcp worker-to-registry "${CLUSTER_BUILD_SELECTED_WORKER_NAMESPACE}" "${CLUSTER_BUILD_SELECTED_WORKER_POD}" "${registry_host}" 5000 deny
  probe_tcp wrong-namespace-to-registry "${CLUSTER_BUILD_UNSELECTED_NAMESPACE}" "${CLUSTER_BUILD_UNSELECTED_NAMESPACE_POD}" "${registry_host}" 5000 deny
  probe_buildkit_egress buildkit-to-registry "${registry_host}" 5000 allow
  probe_buildkit_egress metadata-denied 169.254.169.254 80 deny
  probe_tcp private-target-control "${CLUSTER_BUILD_UNSELECTED_NAMESPACE}" "${CLUSTER_BUILD_UNSELECTED_NAMESPACE_POD}" "${CLUSTER_BUILD_PRIVATE_PROBE_IP}" 80 allow
  probe_buildkit_egress private-cidr-denied "${CLUSTER_BUILD_PRIVATE_PROBE_IP}" 80 deny
}

assert_healthy_pods() {
  evidence_file="$1"
  kube -n "${namespace}" get pods -l app.kubernetes.io/managed-by=compartment -o json >"${evidence_file}"
  jq -e 'all(.items[].status.containerStatuses[]?; .restartCount == 0 and ((.lastState.terminated.reason // "") != "OOMKilled") and ((.state.terminated.reason // "") != "OOMKilled"))' "${evidence_file}" >/dev/null || fail 'platform pod restarted or was OOMKilled'
}

capture_cpu_stat() {
  output="$1"
  kube -n "${namespace}" exec deployment/buildkit -c buildkit -- sh -c 'cat /sys/fs/cgroup/cpu.stat 2>/dev/null || cat /sys/fs/cgroup/cpu/cpu.stat' >"${output}" || fail 'BuildKit cpu.stat throttling evidence is required'
}

capture_cache_state() {
  prefix="$1"
  kube -n "${namespace}" exec deployment/buildkit -c buildkit -- buildctl --addr tcp://127.0.0.1:1234 du --verbose >"${results}/${prefix}-cache.txt"
  kube -n "${namespace}" exec deployment/buildkit -c buildkit -- buildctl --addr tcp://127.0.0.1:1234 du --format '{{.ID}}' | sort -u >"${results}/${prefix}-cache-ids.txt"
  [[ -s "${results}/${prefix}-cache-ids.txt" ]] || fail "${prefix} BuildKit cache state is empty"
}

verify_image() {
  repository="$1" tag="$2" image_ref="$3" evidence_file="$4"
  headers="${scratch}/headers-$RANDOM" manifest="${scratch}/manifest-$RANDOM"
  curl --fail --silent --show-error --user "${CLUSTER_BUILD_REGISTRY_USERNAME}:${CLUSTER_BUILD_REGISTRY_PASSWORD}" \
    --header 'Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json' \
    --dump-header "${headers}" --output "${manifest}" "${CLUSTER_BUILD_REGISTRY_API_URL}/v2/${repository}/manifests/${tag}"
  digest="$(awk 'BEGIN{IGNORECASE=1} /^Docker-Content-Digest:/ {gsub("\r", "", $2); print $2}' "${headers}")"
  [[ "${digest}" == sha256:* && "${image_ref}" == *@"${digest}" ]] || fail "digest mismatch for ${repository}:${tag}"
  sbom_digest="$(jq -r '.manifests[] | select(.platform.os == "unknown" and .platform.architecture == "unknown") | .digest' "${manifest}" | head -n 1)"
  [[ "${sbom_digest}" == sha256:* ]] || fail "missing SBOM attestation manifest for ${repository}:${tag}"
  attestation="${scratch}/attestation-$RANDOM"
  curl --fail --silent --show-error --user "${CLUSTER_BUILD_REGISTRY_USERNAME}:${CLUSTER_BUILD_REGISTRY_PASSWORD}" \
    --header 'Accept: application/vnd.oci.image.manifest.v1+json' \
    --output "${attestation}" "${CLUSTER_BUILD_REGISTRY_API_URL}/v2/${repository}/manifests/${sbom_digest}"
  jq -e '.layers | any(.mediaType == "application/vnd.in-toto+json" and .annotations["in-toto.io/predicate-type"] == "https://spdx.dev/Document")' "${attestation}" >/dev/null || fail "missing SPDX SBOM predicate for ${repository}:${tag}"
  printf '%s\t%s\t%s\tSBOM=present\n' "${repository}" "${tag}" "${digest}" >>"${evidence_file}"
}

evaluate_peak_metrics() {
  [[ -s "${results}/buildkit-usage.tsv" ]] || fail 'BuildKit metrics evidence is empty'
  peak_cpu_millicores="$(awk '{value=$3; if (value ~ /m$/) {sub(/m$/, "", value)} else if (value ~ /^[0-9]+$/) {value*=1000} else {exit 2}; if (value>max) max=value} END {print max+0}' "${results}/buildkit-usage.tsv")"
  peak_memory_mib="$(awk '{value=$4; if (value ~ /Ki$/) {sub(/Ki$/, "", value); value/=1024} else if (value ~ /Mi$/) {sub(/Mi$/, "", value)} else if (value ~ /Gi$/) {sub(/Gi$/, "", value); value*=1024} else {exit 2}; if (value>max) max=value} END {print max+0}' "${results}/buildkit-usage.tsv")"
  printf 'peakCpuMillicores=%s\npeakMemoryMiB=%s\n' "${peak_cpu_millicores}" "${peak_memory_mib}" >"${results}/resource-verdict.txt"
  awk -v value="${peak_cpu_millicores}" 'BEGIN {exit !(value <= 2000)}' || fail 'BuildKit peak CPU exceeded 2 CPU limit'
  awk -v value="${peak_memory_mib}" 'BEGIN {exit !(value <= 2048)}' || fail 'BuildKit peak memory exceeded 2Gi limit'
}

wait_for_platform
assert_pvcs_bound
assert_private_services
run_connectivity_matrix

buildkit_node="$(kube -n "${namespace}" get pod -l app.kubernetes.io/name=buildkit -o jsonpath='{.items[0].spec.nodeName}')"
architecture="$(kube get node "${buildkit_node}" -o jsonpath='{.metadata.labels.kubernetes\.io/arch}')"
[[ -n "${architecture}" ]] || fail 'BuildKit node architecture is required'
printf '%s\n' "${architecture}" >"${results}/node-architecture.txt"
cpu="$(kube -n "${namespace}" get deployment buildkit -o jsonpath='{.spec.template.spec.containers[0].resources.limits.cpu}')"
memory="$(kube -n "${namespace}" get deployment buildkit -o jsonpath='{.spec.template.spec.containers[0].resources.limits.memory}')"
[[ "${cpu}" == '2' && "${memory}" == '2Gi' ]] || fail 'buildkit must be limited to 2 CPU/2Gi'

export CLUSTER_BUILD_REPO_ROOT="${repo}"
export CLUSTER_BUILD_RESULTS_DIR="${results}"
cp "${dir}/build-matrix.ts.in" "${runtime}"
kube -n "${namespace}" top pod -l app.kubernetes.io/name=buildkit --no-headers >/dev/null
: >"${results}/buildkit-usage.tsv"
(
  while true; do
    if sample="$(kube -n "${namespace}" top pod -l app.kubernetes.io/name=buildkit --no-headers 2>>"${results}/metrics-errors.log")" && [[ -n "${sample}" ]]; then
      printf '%s\t%s\n' "$(date -u +%FT%TZ)" "${sample}" >>"${results}/buildkit-usage.tsv"
    fi
    sleep 2
  done
) &
monitor_pid="$!"

pnpm --dir "${repo}" exec tsx "${runtime}"
jq -r '.evidence[] | [.repository, .tag, .imageRef] | @tsv' "${results}/build-evidence.json" >"${results}/images.tsv"
: >"${results}/registry-evidence.tsv"
while IFS=$'\t' read -r repository tag image_ref; do
  verify_image "${repository}" "${tag}" "${image_ref}" "${results}/registry-evidence.tsv"
done <"${results}/images.tsv"
head -n 1 "${results}/images.tsv" >"${results}/persistence-image.tsv"

assert_healthy_pods "${results}/pods-before-restart.json"
capture_cpu_stat "${results}/cpu-stat-before-restart.txt"
capture_cache_state before-restart

prune_job="buildkit-prune-p9-$(date +%s)"
kube -n "${namespace}" create job --from=cronjob/buildkit-prune "${prune_job}" >/dev/null
kube -n "${namespace}" wait "job/${prune_job}" --for=condition=Complete --timeout=180s >/dev/null
kube -n "${namespace}" logs "job/${prune_job}" >"${results}/daily-prune.log"

kube -n "${namespace}" rollout restart deployment/buildkit deployment/registry >/dev/null
kube -n "${namespace}" rollout status deployment/buildkit --timeout=180s >/dev/null
kube -n "${namespace}" rollout status deployment/registry --timeout=180s >/dev/null
assert_pvcs_bound
assert_private_services
assert_healthy_pods "${results}/pods-after-restart.json"
capture_cpu_stat "${results}/cpu-stat-after-restart.txt"
capture_cache_state after-restart
comm -12 "${results}/before-restart-cache-ids.txt" "${results}/after-restart-cache-ids.txt" >"${results}/retained-cache-ids.txt"
[[ -s "${results}/retained-cache-ids.txt" ]] || fail 'BuildKit cache records did not survive restart'

IFS=$'\t' read -r retained_repository retained_tag retained_ref <"${results}/persistence-image.tsv"
verify_image "${retained_repository}" "${retained_tag}" "${retained_ref}" "${results}/post-restart-registry-evidence.tsv"
pnpm --dir "${repo}" exec tsx "${runtime}" post-restart
jq -r '[.repository, .tag, .imageRef] | @tsv' "${results}/post-restart-evidence.json" >"${results}/post-restart-image.tsv"
IFS=$'\t' read -r post_repository post_tag post_ref <"${results}/post-restart-image.tsv"
verify_image "${post_repository}" "${post_tag}" "${post_ref}" "${results}/post-restart-registry-evidence.tsv"
assert_healthy_pods "${results}/pods-final.json"
capture_cpu_stat "${results}/cpu-stat-final.txt"
capture_cache_state final

kill "${monitor_pid}" >/dev/null 2>&1 || true
wait "${monitor_pid}" 2>/dev/null || true
monitor_pid=''
evaluate_peak_metrics
kube -n "${namespace}" get pvc buildkit-data registry-data -o yaml >"${results}/persistent-volumes.yaml"
kube -n "${namespace}" logs deployment/buildkit >"${results}/buildkit.log"
echo 'VERDICT=cluster-build-matrix-passed'
