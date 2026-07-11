#!/usr/bin/env bash
set -euo pipefail

readonly CONTEXT="${1:-k3d-cpt-t5}"
readonly EXPECTED_CONTEXT="k3d-cpt-t5"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly DIR
readonly RESULTS="${DIR}/t5-results.tsv"
readonly BOOTSTRAP="system:serviceaccount:compartment:compartment-bootstrap"
readonly CONTROLLER="system:serviceaccount:project-a:compartment-controller"
readonly USER_SA="system:serviceaccount:project-a:workload-user"
readonly SERVER_CONTAINER="k3d-cpt-t5-server-0"
readonly INITIAL_VALUE="t5-plaintext-datastore-marker-7ec9b2"
readonly MANUAL_VALUE="t5-manual-rotation-4ad183"
readonly CHECKSUM_VALUE="t5-checksum-rotation-b50c91"

if [[ "${CONTEXT}" != "${EXPECTED_CONTEXT}" ]]; then
  echo "T5 requires context ${EXPECTED_CONTEXT}; got ${CONTEXT}." >&2
  exit 2
fi

k() { kubectl --context "${CONTEXT}" "$@"; }
as_bootstrap() { k --as="${BOOTSTRAP}" "$@"; }
as_controller() { k --as="${CONTROLLER}" "$@"; }

record_can_i() {
  local actor="$1" verb="$2" resource="$3" namespace="$4" expected="$5" subresource="${6:-}" actual verdict operation
  local -a args=(auth can-i "${verb}" "${resource}" --as="${actor}")
  if [[ "${namespace}" != "-" ]]; then args+=(--namespace "${namespace}"); fi
  if [[ -n "${subresource}" ]]; then args+=(--subresource "${subresource}"); fi
  if ! actual="$(k "${args[@]}")"; then :; fi
  verdict=FAIL
  [[ "${actual}" == "${expected}" ]] && verdict=PASS
  operation="${verb} ${resource}"
  if [[ -n "${subresource}" ]]; then operation+="/${subresource}"; fi
  printf 'rbac\t%s\t%s\t%s\t%s\t%s\t%s\n' "${actor}" "${operation}" "${namespace}" "${expected}" "${actual}" "${verdict}" | tee -a "${RESULTS}"
  [[ "${verdict}" == PASS ]]
}

record_probe() {
  local actor="$1" operation="$2" expected="$3" command="$4" actual verdict output
  if output="$(eval "${command}" 2>&1)"; then
    actual=allowed
  elif [[ "${expected}" == absent ]]; then
    actual=absent
  elif grep -qi forbidden <<<"${output}"; then
    actual=forbidden
  else
    actual=error
  fi
  verdict=FAIL
  [[ "${actual}" == "${expected}" ]] && verdict=PASS
  printf 'probe\t%s\t%s\t-\t%s\t%s\t%s\n' "${actor}" "${operation}" "${expected}" "${actual}" "${verdict}" | tee -a "${RESULTS}"
  [[ "${verdict}" == PASS ]]
}

wait_workload() {
  k -n project-a rollout status deployment/workload-user --timeout=180s >/dev/null
}

pod_name() {
  k -n project-a get pod -l app=workload-user --sort-by=.metadata.creationTimestamp -o name | tail -1 | cut -d/ -f2
}

pod_value() {
  k -n project-a exec "$(pod_name)" -- cat /tmp/secret-value
}

snapshot_contains() (
  local marker="$1" snapshot_dir
  snapshot_dir="$(mktemp -d)"
  trap 'docker unpause "${SERVER_CONTAINER}" >/dev/null 2>&1 || true; rm -rf "${snapshot_dir}"' EXIT INT TERM
  docker pause "${SERVER_CONTAINER}" >/dev/null
  docker cp "${SERVER_CONTAINER}:/var/lib/rancher/k3s/server/db/state.db" "${snapshot_dir}/state.db" >/dev/null
  docker cp "${SERVER_CONTAINER}:/var/lib/rancher/k3s/server/db/state.db-wal" "${snapshot_dir}/state.db-wal" >/dev/null 2>&1 || true
  docker cp "${SERVER_CONTAINER}:/var/lib/rancher/k3s/server/db/state.db-shm" "${snapshot_dir}/state.db-shm" >/dev/null 2>&1 || true
  docker unpause "${SERVER_CONTAINER}" >/dev/null
  sqlite3 "${snapshot_dir}/state.db" ".backup '${snapshot_dir}/snapshot.db'"
  grep -aFq "${marker}" "${snapshot_dir}/snapshot.db"
)

: >"${RESULTS}"
printf 'kind\tactor\toperation\tnamespace\texpected\tactual\tverdict\n' >>"${RESULTS}"

k delete namespace project-a project-b platform-ns --ignore-not-found --wait >/dev/null
k delete clusterrolebinding compartment-project-bootstrap --ignore-not-found >/dev/null
k delete clusterrole compartment-project-bootstrap --ignore-not-found >/dev/null
k delete clusterrole compartment-controller --ignore-not-found >/dev/null
k apply -f "${DIR}/controller-rbac.yaml" >/dev/null
k apply -f "${DIR}/bootstrap-rbac.yaml" >/dev/null

# Negative-first RBAC matrix.
record_can_i "${CONTROLLER}" create deployments.apps project-b no
record_can_i "${CONTROLLER}" create secrets project-b no
record_can_i "${CONTROLLER}" create deployments.apps platform-ns no
record_can_i "${CONTROLLER}" create namespaces - no
record_can_i "${CONTROLLER}" create clusterrolebindings.rbac.authorization.k8s.io - no
record_can_i "${BOOTSTRAP}" create deployments.apps project-a no
record_can_i "${BOOTSTRAP}" get secrets project-a no
record_can_i "${BOOTSTRAP}" create clusterroles.rbac.authorization.k8s.io - no
record_can_i "${BOOTSTRAP}" create clusterrolebindings.rbac.authorization.k8s.io - no
record_can_i "${USER_SA}" get secrets project-a no
record_can_i "${USER_SA}" get secrets project-b no

record_can_i "${BOOTSTRAP}" create namespaces - yes
record_can_i "${BOOTSTRAP}" create serviceaccounts project-a yes
record_can_i "${BOOTSTRAP}" create roles.rbac.authorization.k8s.io project-a yes
record_can_i "${BOOTSTRAP}" create rolebindings.rbac.authorization.k8s.io project-a yes
record_can_i "${BOOTSTRAP}" bind clusterroles.rbac.authorization.k8s.io/compartment-controller - yes

as_bootstrap create -f "${DIR}/namespaces.yaml" >/dev/null
as_bootstrap create -f "${DIR}/project-a-binding.yaml" >/dev/null
k apply -f "${DIR}/fixtures.yaml" >/dev/null
wait_workload

record_can_i "${CONTROLLER}" create deployments.apps project-a yes
record_can_i "${CONTROLLER}" create secrets project-a yes
record_can_i "${CONTROLLER}" create services project-a yes
record_can_i "${CONTROLLER}" create jobs.batch project-a yes
record_can_i "${CONTROLLER}" create networkpolicies.networking.k8s.io project-a yes
record_can_i "${CONTROLLER}" get pods project-a yes log

record_probe controller 'create own Secret' allowed \
  "as_controller -n project-a create secret generic controller-created --from-literal=value=ok"
record_probe controller 'create own Deployment' allowed \
  "as_controller -n project-a create deployment controller-created --image=busybox:1.37.0 -- sleep 60"
record_probe controller 'create foreign Secret' forbidden \
  "as_controller -n project-b create secret generic forbidden --from-literal=value=no"
record_probe controller 'create platform Deployment' forbidden \
  "as_controller -n platform-ns create deployment forbidden --image=busybox:1.37.0 -- sleep 60"
record_probe bootstrap 'read workload Secret' forbidden \
  "as_bootstrap -n project-a get secret workload-secret"
record_probe bootstrap 'create workload Deployment' forbidden \
  "as_bootstrap -n project-a create deployment forbidden --image=busybox:1.37.0 -- sleep 60"
k delete clusterrolebinding compartment-project-bootstrap >/dev/null
record_can_i "${BOOTSTRAP}" create namespaces - no

pod="$(pod_name)"
record_probe workload-user 'service-account token absent' absent \
  "k -n project-a exec ${pod} -- test -f /var/run/secrets/kubernetes.io/serviceaccount/token"
own_code="$(k -n project-a exec "${pod}" -- curl -ksS -o /dev/null -w '%{http_code}' https://kubernetes.default/api/v1/namespaces/project-a/secrets/workload-secret)"
foreign_code="$(k -n project-a exec "${pod}" -- curl -ksS -o /dev/null -w '%{http_code}' https://kubernetes.default/api/v1/namespaces/project-b/secrets/foreign)"
for entry in "own Secret:${own_code}" "foreign Secret:${foreign_code}"; do
  operation="${entry%%:*}"; code="${entry##*:}"; verdict=FAIL
  [[ "${code}" == 401 || "${code}" == 403 ]] && verdict=PASS
  printf 'api\tworkload-user\tread %s\t-\t401/403\t%s\t%s\n' "${operation}" "${code}" "${verdict}" | tee -a "${RESULTS}"
  [[ "${verdict}" == PASS ]]
done

snapshot_contains "${INITIAL_VALUE}"
printf 'datastore\tk3s\tplaintext marker before encryption\t-\tpresent\tpresent\tPASS\n' | tee -a "${RESULTS}"

k3d cluster delete cpt-t5 >/dev/null
k3d cluster create cpt-t5 \
  --k3s-arg '--disable=traefik@server:*' \
  --k3s-arg '--secrets-encryption@server:*' \
  --wait >/dev/null
k apply -f "${DIR}/namespaces.yaml" >/dev/null
k apply -f "${DIR}/fixtures.yaml" >/dev/null
wait_workload
if snapshot_contains "${INITIAL_VALUE}"; then
  printf 'datastore\tk3s\tmarker with encryption\t-\tabsent\tpresent\tFAIL\n' | tee -a "${RESULTS}"
  exit 1
fi
encryption_status="$(docker exec "${SERVER_CONTAINER}" k3s secrets-encrypt status 2>/dev/null)"
encryption_actual=disabled
grep -q 'Encryption Status: Enabled' <<<"${encryption_status}" && encryption_actual=enabled
printf 'datastore\tk3s\tmarker with encryption\t-\tabsent\tabsent\tPASS\n' | tee -a "${RESULTS}"
encryption_verdict=FAIL; [[ "${encryption_actual}" == enabled ]] && encryption_verdict=PASS
printf 'datastore\tk3s\tencryption status\t-\tenabled\t%s\t%s\n' "${encryption_actual}" "${encryption_verdict}" | tee -a "${RESULTS}"
[[ "${encryption_verdict}" == PASS ]]

k -n project-a create secret generic workload-secret --from-literal="value=${MANUAL_VALUE}" --dry-run=client -o yaml | k apply -f - >/dev/null
k -n project-a delete pod "$(pod_name)" --wait >/dev/null
wait_workload
manual_actual="$(pod_value)"
manual_verdict=FAIL; [[ "${manual_actual}" == "${MANUAL_VALUE}" ]] && manual_verdict=PASS
printf 'rotation\tworkload-user\tmanual pod restart\tproject-a\t%s\t%s\t%s\n' "${MANUAL_VALUE}" "${manual_actual}" "${manual_verdict}" | tee -a "${RESULTS}"
[[ "${manual_verdict}" == PASS ]]

old_pod="$(pod_name)"
k -n project-a create secret generic workload-secret --from-literal="value=${CHECKSUM_VALUE}" --dry-run=client -o yaml | k apply -f - >/dev/null
checksum="$(printf %s "${CHECKSUM_VALUE}" | openssl dgst -sha256 | awk '{print $2}')"
k -n project-a patch deployment workload-user --type=merge -p "{\"spec\":{\"template\":{\"metadata\":{\"annotations\":{\"compartment.dev/secret-checksum\":\"${checksum}\"}}}}}" >/dev/null
wait_workload
new_pod="$(pod_name)"
checksum_actual="$(pod_value)"
checksum_verdict=FAIL
[[ "${old_pod}" != "${new_pod}" && "${checksum_actual}" == "${CHECKSUM_VALUE}" ]] && checksum_verdict=PASS
printf 'rotation\tworkload-user\tchecksum rollout\tproject-a\tnew pod and %s\t%s / %s\t%s\n' "${CHECKSUM_VALUE}" "${new_pod}" "${checksum_actual}" "${checksum_verdict}" | tee -a "${RESULTS}"
[[ "${checksum_verdict}" == PASS ]]

if grep -q $'\tFAIL$' "${RESULTS}"; then
  echo 'T5 matrix failed.' >&2
  exit 1
fi
echo "T5 matrix passed: ${RESULTS}"
