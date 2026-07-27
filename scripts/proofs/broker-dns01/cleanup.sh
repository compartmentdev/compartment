#!/usr/bin/env bash
set -euo pipefail

cluster_name="${BROKER_DNS01_CLUSTER_NAME:-proof-broker-dns01}"
solver_image="compartment-proof/broker-dns01-solver:v1.21.0"

if k3d cluster list --no-headers 2>/dev/null | awk '{print $1}' | grep -Fxq "$cluster_name"; then
  k3d cluster delete "$cluster_name"
fi

if [[ "$(docker image inspect "$solver_image" --format '{{index .Config.Labels "io.compartment.proof"}}' 2>/dev/null || true)" == "broker-dns01" ]]; then
  docker image rm "$solver_image"
fi
