#!/usr/bin/env bash
set -euo pipefail

readonly CONTEXT="${1:-k3d-cpt-t1}"
if [[ "${CONTEXT}" != "k3d-cpt-t1" ]]; then
  echo "T1 only supports context k3d-cpt-t1" >&2
  exit 2
fi

docker build -t compartment-t1:local spike/t1/app
k3d image import compartment-t1:local --cluster cpt-t1
kubectl --context "${CONTEXT}" apply --server-side --field-manager=t1 --force-conflicts \
  -f spike/t1/manifests/base.yaml
kubectl --context "${CONTEXT}" --namespace compartment-bench rollout status deployment/bench-web --timeout=60s
kubectl --context "${CONTEXT}" --namespace compartment-bench rollout status deployment/bench-ws --timeout=60s
