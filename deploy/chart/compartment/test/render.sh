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
helm template compartment "${CHART_DIR}" --set platform.startupStage=full --set secrets.registryWritePassword=test-write-password --set secrets.productLogIngestToken=test-product-log-token >"${OUTPUT_DIR}/full.yaml"
helm template compartment "${CHART_DIR}" -f "${CHART_DIR}/values-kind.yaml" >"${OUTPUT_DIR}/kind.yaml"
helm template compartment "${CHART_DIR}" --set platform.startupStage=full --set secrets.registryWritePassword=test-write-password --set secrets.productLogIngestToken=test-product-log-token --set edge.snapshots.enabled=true >"${OUTPUT_DIR}/edge.yaml"
node "${CHART_DIR}/test/assert-project-provisioning-rbac.mjs" "${OUTPUT_DIR}/full.yaml"

if helm template compartment "${CHART_DIR}" --kube-version 1.29.9 --set platform.startupStage=full --set secrets.registryWritePassword=test-write-password --set secrets.productLogIngestToken=test-product-log-token >/dev/null 2>&1; then
  echo 'Chart must fail closed on Kubernetes versions without admissionregistration.k8s.io/v1 ValidatingAdmissionPolicy.' >&2
  exit 1
fi

grep -q 'kind: CronJob' "${OUTPUT_DIR}/full.yaml"
grep -q 'kind: NetworkPolicy' "${OUTPUT_DIR}/full.yaml"
grep -q 'pod-security.kubernetes.io/enforce: privileged' "${OUTPUT_DIR}/full.yaml"
grep -q -- '--oci-worker-no-process-sandbox' "${OUTPUT_DIR}/full.yaml"
grep -q -- '--oci-worker-gc-keepstorage' "${OUTPUT_DIR}/full.yaml"
grep -q 'namespace: compartment-build' "${OUTPUT_DIR}/full.yaml"
grep -q 'COMPARTMENT_ARTIFACT_REGISTRY_HOST: "compartment-compartment-registry-auth.default.svc"' "${OUTPUT_DIR}/full.yaml"
grep -q 'COMPARTMENT_ARTIFACT_REGISTRY_INTERNAL_URL: "http://compartment-compartment-registry-auth.default.svc:5000"' "${OUTPUT_DIR}/full.yaml"
grep -A1 -q 'name: COMPARTMENT_WORKER_IMAGE' "${OUTPUT_DIR}/full.yaml"
grep -q 'value: "ghcr.io/compartmentdev/compartment-worker:latest"' "${OUTPUT_DIR}/full.yaml"
grep -q '\\"compartment-compartment-registry-auth.default.svc:5000\\"' "${OUTPUT_DIR}/full.yaml"
grep -q 'name: compartment-compartment-project-provisioner' "${OUTPUT_DIR}/full.yaml"
grep -q 'command:.*project-provisioner-server.js' "${OUTPUT_DIR}/full.yaml"
grep -q 'resources: \["services", "secrets", "persistentvolumeclaims"\]' "${OUTPUT_DIR}/full.yaml"
if grep -q 'cluster-admin' "${OUTPUT_DIR}/full.yaml"; then
  echo 'Chart must not grant cluster-admin.' >&2
  exit 1
fi
sed -n '/^kind: ClusterRoleBinding$/,/^---$/p' "${OUTPUT_DIR}/full.yaml" >"${OUTPUT_DIR}/cluster-role-bindings.yaml"
if grep -q 'name: compartment-compartment-worker' "${OUTPUT_DIR}/cluster-role-bindings.yaml"; then
  echo 'Worker must not receive cluster-scoped authority.' >&2
  exit 1
fi
sed -n '/^kind: ServiceAccount$/,/^---$/p' "${OUTPUT_DIR}/full.yaml" >"${OUTPUT_DIR}/service-accounts.yaml"
if grep -q 'name: compartment-compartment-project-bootstrap' "${OUTPUT_DIR}/service-accounts.yaml"; then
  echo 'Bootstrap ServiceAccount must be created only for a provisioning Job.' >&2
  exit 1
fi
sed -n '/^kind: NetworkPolicy$/,/^---$/p' "${OUTPUT_DIR}/full.yaml" | sed -n '/name: compartment-compartment-registry-auth/,/^---$/p' >"${OUTPUT_DIR}/registry-auth-policy.yaml"
sed -n '/^kind: Deployment$/,/^---$/p' "${OUTPUT_DIR}/full.yaml" | sed -n '/name: compartment-compartment-worker/,/^---$/p' >"${OUTPUT_DIR}/worker.yaml"
sed -n '/^      containers:$/,/^      volumes:$/p' "${OUTPUT_DIR}/worker.yaml" >"${OUTPUT_DIR}/worker-container.yaml"
sed -n '/^      volumes:$/,$p' "${OUTPUT_DIR}/worker.yaml" >"${OUTPUT_DIR}/worker-volumes.yaml"
grep -q 'app.kubernetes.io/component: worker' "${OUTPUT_DIR}/registry-auth-policy.yaml"
grep -q 'app.kubernetes.io/component: buildkit' "${OUTPUT_DIR}/registry-auth-policy.yaml"
grep -A1 -q '^    - ports:$' "${OUTPUT_DIR}/registry-auth-policy.yaml"
grep -q 'port: 5000' "${OUTPUT_DIR}/registry-auth-policy.yaml"
grep -q '{name: kube-api-access, mountPath: /var/run/secrets/kubernetes.io/serviceaccount, readOnly: true}' "${OUTPUT_DIR}/worker-container.yaml"
grep -q '^        - name: kube-api-access$' "${OUTPUT_DIR}/worker-volumes.yaml"
grep -q '^          projected:$' "${OUTPUT_DIR}/worker-volumes.yaml"
grep -q '^                  path: token$' "${OUTPUT_DIR}/worker-volumes.yaml"
grep -A2 -q '^              - configMap:$' "${OUTPUT_DIR}/worker-volumes.yaml"
grep -q '^                  name: kube-root-ca.crt$' "${OUTPUT_DIR}/worker-volumes.yaml"
grep -q '{key: ca.crt, path: ca.crt}' "${OUTPUT_DIR}/worker-volumes.yaml"
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
