#!/usr/bin/env bash
set -euo pipefail

CHART_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly CHART_DIR
OUTPUT_DIR="$(mktemp -d)"
readonly OUTPUT_DIR
trap 'rm -rf "${OUTPUT_DIR}"' EXIT

helm lint "${CHART_DIR}"
helm lint "${CHART_DIR}" -f "${CHART_DIR}/values-kind.yaml"
helm template compartment "${CHART_DIR}" --set platform.startupStage=foundation >"${OUTPUT_DIR}/foundation.yaml"
helm template compartment "${CHART_DIR}" --set platform.startupStage=full --set secrets.registryWritePassword=test-write-password >"${OUTPUT_DIR}/full.yaml"
helm template compartment "${CHART_DIR}" -f "${CHART_DIR}/values-kind.yaml" >"${OUTPUT_DIR}/kind.yaml"
helm template compartment "${CHART_DIR}" --set platform.startupStage=full --set secrets.registryWritePassword=test-write-password --set edge.snapshots.enabled=true >"${OUTPUT_DIR}/edge.yaml"

grep -q 'kind: CronJob' "${OUTPUT_DIR}/full.yaml"
grep -q 'kind: NetworkPolicy' "${OUTPUT_DIR}/full.yaml"
grep -q 'pod-security.kubernetes.io/enforce: privileged' "${OUTPUT_DIR}/full.yaml"
grep -q -- '--oci-worker-no-process-sandbox' "${OUTPUT_DIR}/full.yaml"
grep -q -- '--oci-worker-gc-keepstorage' "${OUTPUT_DIR}/full.yaml"
grep -q 'namespace: compartment-build' "${OUTPUT_DIR}/full.yaml"
grep -q 'compartment-compartment-edge-snapshots' "${OUTPUT_DIR}/edge.yaml"
if grep -q 'kind: CronJob' "${OUTPUT_DIR}/foundation.yaml"; then
  echo 'Foundation stage unexpectedly rendered the BuildKit prune job.' >&2
  exit 1
fi
if grep -q 'compartment-compartment-edge-snapshots' "${OUTPUT_DIR}/full.yaml"; then
  echo 'Edge snapshot storage must be disabled by default.' >&2
  exit 1
fi
if grep -q 'app.kubernetes.io/component: buildkit' "${OUTPUT_DIR}/kind.yaml"; then
  echo 'Restricted profile unexpectedly rendered BuildKit.' >&2
  exit 1
fi
