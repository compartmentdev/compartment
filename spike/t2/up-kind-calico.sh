#!/usr/bin/env bash
set -euo pipefail

readonly CLUSTER=cpt-t2-calico
readonly CONTEXT=kind-cpt-t2-calico
readonly CALICO_VERSION=v3.32.1
[[ "$(uname -m)" == arm64 ]] || echo "note: host architecture is $(uname -m), arm64 was the reference"
if kind get clusters | grep -Fxq "${CLUSTER}"; then echo "${CLUSTER} already exists" >&2; exit 1; fi
kind create cluster --name "${CLUSTER}" --config "$(dirname "$0")/kind-calico.yaml"
trap 'kind delete cluster --name "${CLUSTER}"' ERR INT TERM
kubectl --context "${CONTEXT}" create -f "https://raw.githubusercontent.com/projectcalico/calico/${CALICO_VERSION}/manifests/v1_crd_projectcalico_org.yaml"
kubectl --context "${CONTEXT}" create -f "https://raw.githubusercontent.com/projectcalico/calico/${CALICO_VERSION}/manifests/tigera-operator.yaml"
kubectl --context "${CONTEXT}" wait --for=condition=Established crd/installations.operator.tigera.io --timeout=120s
kubectl --context "${CONTEXT}" create -f "https://raw.githubusercontent.com/projectcalico/calico/${CALICO_VERSION}/manifests/custom-resources.yaml"
for _ in $(seq 1 120); do
  kubectl --context "${CONTEXT}" get namespace calico-system >/dev/null 2>&1 && break
  sleep 1
done
kubectl --context "${CONTEXT}" -n calico-system rollout status daemonset/calico-node --timeout=5m
kubectl --context "${CONTEXT}" -n calico-system rollout status deployment/calico-kube-controllers --timeout=5m
trap - ERR INT TERM
echo "context: ${CONTEXT}"
echo "remove: $(dirname "$0")/down-kind-calico.sh"
