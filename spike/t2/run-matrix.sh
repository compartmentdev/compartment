#!/usr/bin/env bash
set -euo pipefail

context="${1:?usage: $0 <context> <pod-cidr> <service-cidr> <agent-namespace> <agent-selector>}"
pod_cidr="${2:?}"
service_cidr="${3:?}"
agent_namespace="${4:?}"
agent_selector="${5:?}"
out="${6:-/dev/stdout}"
dir="$(cd "$(dirname "$0")" && pwd)"

kubectl --context "${context}" delete namespace ns-a ns-b platform-ns --ignore-not-found --wait >/dev/null
kubectl --context "${context}" apply -f "${dir}/fixtures.yaml" >/dev/null
for ns in ns-a ns-b platform-ns; do kubectl --context "${context}" -n "${ns}" wait deployment --all --for=condition=Available --timeout=120s >/dev/null; done
client="$(kubectl --context "${context}" -n ns-a get pod -l app=client -o jsonpath='{.items[0].metadata.name}')"
caddy="$(kubectl --context "${context}" -n platform-ns get pod -l app=caddy -o jsonpath='{.items[0].metadata.name}')"
api_ip="$(kubectl --context "${context}" -n default get service kubernetes -o jsonpath='{.spec.clusterIP}')"
node_container="$(kubectl --context "${context}" -n ns-a get pod "${client}" -o jsonpath='{.spec.nodeName}')"
helper="$(docker create busybox:1.37.0)"
helper_file="$(mktemp)"
trap 'docker rm -f "${helper}" >/dev/null 2>&1 || true; rm -f "${helper_file}"' EXIT
docker cp "${helper}:/bin/busybox" "${helper_file}"
docker cp "${helper_file}" "${node_container}:/tmp/t2-busybox"
docker rm "${helper}" >/dev/null
helper=''
docker exec "${node_container}" sh -c 'ip addr add 169.254.169.254/32 dev lo 2>/dev/null || true; (/tmp/t2-busybox httpd -f -p 18080 -h /tmp) >/tmp/t2-linklocal.log 2>&1 &' >/dev/null

from_client() { kubectl --context "${context}" -n ns-a exec "${client}" -- sh -c "$1" >/dev/null 2>&1; }
from_caddy() { kubectl --context "${context}" -n platform-ns exec "${caddy}" -- sh -c "$1" >/dev/null 2>&1; }
record() {
  local phase="$1" row="$2" expected="$3" command="$4" actual
  if eval "${command}"; then actual=allow; else actual=deny; fi
  local verdict=FAIL; [[ "${actual}" == "${expected}" ]] && verdict=PASS
  printf '%s\t%s\t%s\t%s\t%s\n' "${phase}" "${row}" "${expected}" "${actual}" "${verdict}" | tee -a "${out}"
}
run_phase() {
  local phase="$1" deny="$2"
  record "${phase}" 1 "${deny}" "from_client 'wget -q -T 2 -O /dev/null http://foreign.ns-b.svc:8080'"
  record "${phase}" 2 "${deny}" "from_client 'wget -q -T 2 -O /dev/null http://169.254.169.254:18080'"
  record "${phase}" 3 "${deny}" "from_client 'wget -q -T 2 -O /dev/null http://platform.platform-ns.svc:8080'"
  record "${phase}" 4 allow "from_client 'wget -q -T 2 -O /dev/null http://resource.ns-a.svc:8080'"
  record "${phase}" 5 allow "from_caddy 'wget -q -T 2 -O /dev/null http://app.ns-a.svc:8080'"
  record "${phase}" 6 allow "from_client 'nslookup kubernetes.default.svc.cluster.local'"
  record "${phase}" 7 "${deny}" "from_client 'nc -z -w 2 ${api_ip} 443'"
}

: >"${out}"
run_phase without-policy allow
start_ms="$(($(date +%s) * 1000))"
sed -e "s|__POD_CIDR__|${pod_cidr}|" -e "s|__SERVICE_CIDR__|${service_cidr}|" "${dir}/policies.yaml.tpl" | kubectl --context "${context}" apply -f - >/dev/null
latency_ms=-1
for _ in $(seq 1 100); do
  if ! from_client 'wget -q -T 1 -O /dev/null http://foreign.ns-b.svc:8080'; then latency_ms="$(($(date +%s) * 1000 - start_ms))"; break; fi
  sleep 0.1
done
printf 'latency_ms\t%s\n' "${latency_ms}" | tee -a "${out}"
run_phase with-policy deny

fail_open=0
(for _ in $(seq 1 40); do from_client 'wget -q -T 1 -O /dev/null http://foreign.ns-b.svc:8080' && echo fail-open; sleep 0.25; done) >"${out}.restart" & probe_pid=$!
agent_pod="$(kubectl --context "${context}" -n "${agent_namespace}" get pod -l "${agent_selector}" -o jsonpath='{.items[0].metadata.name}')"
kubectl --context "${context}" -n "${agent_namespace}" delete pod "${agent_pod}" --wait=false >/dev/null
kubectl --context "${context}" -n "${agent_namespace}" wait pod -l "${agent_selector}" --for=condition=Ready --timeout=180s >/dev/null
wait "${probe_pid}" || true
grep -q fail-open "${out}.restart" && fail_open=1
post=deny; from_client 'wget -q -T 2 -O /dev/null http://foreign.ns-b.svc:8080' && post=allow
printf 'restart\t8\tdeny-throughout\tfail_open=%s,post=%s\t%s\n' "${fail_open}" "${post}" "$([[ ${fail_open} == 0 && ${post} == deny ]] && echo PASS || echo FAIL)" | tee -a "${out}"
