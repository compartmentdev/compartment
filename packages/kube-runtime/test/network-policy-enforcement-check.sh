#!/usr/bin/env bash
set -euo pipefail

context="${1:?usage: $0 <enforcing-kube-context> <pod-cidr> <service-cidr>}"
pod_cidr="${2:?}"
service_cidr="${3:?}"
dir="$(cd "$(dirname "$0")" && pwd)"
results="$(mktemp)"

kubectl --context "${context}" delete namespace ns-a ns-b platform-ns --ignore-not-found --wait >/dev/null
trap 'kubectl --context "${context}" delete namespace ns-a ns-b platform-ns --ignore-not-found --wait=false >/dev/null; rm -f "${results}"' EXIT
kubectl --context "${context}" apply -f "${dir}/network-policy-enforcement-fixtures.yaml" >/dev/null
for namespace in ns-a ns-b platform-ns; do
  kubectl --context "${context}" -n "${namespace}" wait deployment --all --for=condition=Available --timeout=120s >/dev/null
done

application="$(kubectl --context "${context}" -n ns-a get pod -l compartment.test/role=application -o jsonpath='{.items[0].metadata.name}')"
release="$(kubectl --context "${context}" -n ns-a get pod -l compartment.dev/job-class=release -o jsonpath='{.items[0].metadata.name}')"
caddy="$(kubectl --context "${context}" -n platform-ns get pod -l app=caddy -o jsonpath='{.items[0].metadata.name}')"
from_application() { kubectl --context "${context}" -n ns-a exec "${application}" -- sh -c "$1" >/dev/null 2>&1; }
from_release() { kubectl --context "${context}" -n ns-a exec "${release}" -- sh -c "$1" >/dev/null 2>&1; }
from_caddy() { kubectl --context "${context}" -n platform-ns exec "${caddy}" -- sh -c "$1" >/dev/null 2>&1; }

record() {
  local phase="$1" probe="$2" expected="$3" command="$4" actual='deny'
  if eval "${command}"; then actual='allow'; fi
  local verdict='FAIL'
  if [[ "${actual}" == "${expected}" ]]; then verdict='PASS'; fi
  printf '%s\t%s\t%s\t%s\t%s\n' "${phase}" "${probe}" "${expected}" "${actual}" "${verdict}" | tee -a "${results}"
}

run_matrix() {
  local phase="$1" isolated="$2"
  record "${phase}" application-to-project "${isolated}" "from_application 'wget -q -T 2 -O /dev/null http://foreign.ns-b.svc:8080'"
  record "${phase}" application-to-platform "${isolated}" "from_application 'wget -q -T 2 -O /dev/null http://platform.platform-ns.svc:8080'"
  record "${phase}" application-to-resource allow "from_application 'wget -q -T 2 -O /dev/null http://resource.ns-a.svc:8080'"
  record "${phase}" application-dns allow "from_application 'nslookup kubernetes.default.svc.cluster.local'"
  record "${phase}" release-to-project "${isolated}" "from_release 'wget -q -T 2 -O /dev/null http://foreign.ns-b.svc:8080'"
  record "${phase}" release-to-platform "${isolated}" "from_release 'wget -q -T 2 -O /dev/null http://platform.platform-ns.svc:8080'"
  record "${phase}" release-to-resource allow "from_release 'wget -q -T 2 -O /dev/null http://resource.ns-a.svc:8080'"
  record "${phase}" release-dns allow "from_release 'nslookup kubernetes.default.svc.cluster.local'"
  record "${phase}" caddy-to-application allow "from_caddy 'wget -q -T 2 -O /dev/null http://app.ns-a.svc:8080'"
}

: >"${results}"
run_matrix without-policy allow
pnpm --dir "${dir}/.." test:network-policy:render "${pod_cidr}" "${service_cidr}" |
  kubectl --context "${context}" apply -f - >/dev/null

for _ in $(seq 1 30); do
  if ! from_release 'wget -q -T 1 -O /dev/null http://foreign.ns-b.svc:8080'; then break; fi
  sleep 1
done
run_matrix with-policy deny

if grep -q $'\tFAIL$' "${results}"; then
  echo 'VERDICT=matrix-failed'
  exit 1
fi
echo 'VERDICT=enforced'
