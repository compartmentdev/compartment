#!/usr/bin/env bash
set -euo pipefail

readonly CONTEXT="${1:-$(kubectl config current-context)}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
readonly REPO_ROOT

if ! docker context inspect colima >/dev/null 2>&1; then
  echo "Docker context 'colima' is unavailable; run spike/env/doctor.sh first." >&2
  exit 1
fi
docker context use colima >/dev/null

docker build --tag compartment-bench-ws:local "${SCRIPT_DIR}/ws-server"
case "${CONTEXT}" in
  k3d-*)
    k3d image import --cluster "${CONTEXT#k3d-}" compartment-bench-ws:local
    ;;
  kind-*)
    kind load docker-image --name "${CONTEXT#kind-}" compartment-bench-ws:local
    ;;
  *)
    echo "Unsupported context ${CONTEXT}; expected k3d-* or kind-*" >&2
    exit 2
    ;;
esac

kubectl --context "${CONTEXT}" create namespace compartment-bench --dry-run=client -o yaml \
  | kubectl --context "${CONTEXT}" apply -f -
kubectl --context "${CONTEXT}" label namespace compartment-bench \
  pod-security.kubernetes.io/enforce=restricted \
  pod-security.kubernetes.io/audit=restricted \
  pod-security.kubernetes.io/warn=restricted \
  --overwrite

kubectl --context "${CONTEXT}" --namespace compartment-bench create configmap bench-web-source \
  --from-file=server.mjs="${REPO_ROOT}/examples/multi-service/services/web/server.mjs" \
  --dry-run=client -o yaml | kubectl --context "${CONTEXT}" apply -f -
kubectl --context "${CONTEXT}" --namespace compartment-bench create configmap bench-backoffice-source \
  --from-file=server.mjs="${REPO_ROOT}/examples/multi-service/services/backoffice/server.mjs" \
  --dry-run=client -o yaml | kubectl --context "${CONTEXT}" apply -f -
kubectl --context "${CONTEXT}" --namespace compartment-bench create configmap bench-caddy-config \
  --from-file=Caddyfile="${SCRIPT_DIR}/Caddyfile" \
  --dry-run=client -o yaml | kubectl --context "${CONTEXT}" apply -f -

kubectl --context "${CONTEXT}" apply -f "${SCRIPT_DIR}/manifests.yaml"
kubectl --context "${CONTEXT}" --namespace compartment-bench wait deployment --all --for=condition=Available --timeout=3m

echo "Bench is ready in context ${CONTEXT}."
echo "Run: ${SCRIPT_DIR}/load.sh ${CONTEXT} 60 200 30"
echo "Run: ${SCRIPT_DIR}/ws.sh ${CONTEXT} 100 60"
