#!/usr/bin/env bash
set -u

output_dir="${1:?Usage: collect-platform-k3d-e2e-diagnostics.sh <output-dir>}"
context="k3d-compartment-e2e"
mkdir -p "$output_dir"

capture() {
  local name="$1"
  shift
  {
    echo "+ $*"
    "$@"
  } >"$output_dir/$name.log" 2>&1 || true
}

capture pods kubectl --context "$context" get pods --all-namespaces -o wide
capture deployments kubectl --context "$context" get deployments --all-namespaces -o wide
capture helm-status helm status compartment --kube-context "$context" --namespace compartment
capture events kubectl --context "$context" get events --all-namespaces --sort-by=.lastTimestamp

while IFS= read -r deployment; do
  namespace="${deployment%%/*}"
  name="${deployment#*/}"
  capture "describe-${namespace}-${name}" kubectl --context "$context" --namespace "$namespace" describe deployment "$name"
  capture "logs-${namespace}-${name}" kubectl --context "$context" --namespace "$namespace" logs "deployment/$name" --all-containers --tail=500
done < <(kubectl --context "$context" get deployments --all-namespaces -o jsonpath='{range .items[*]}{.metadata.namespace}{"/"}{.metadata.name}{"\n"}{end}' 2>/dev/null || true)
