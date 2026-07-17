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
helm template compartment "${CHART_DIR}" --set platform.startupStage=full --set platform.installationId=test-install --set platform.baseDomain=apps.example.com --set platform.publicProtocol=https --set platform.publicIngressIpv4=8.8.8.8 --set-string platform.managedDomainBrokerUrl= --set secrets.registryWritePassword=test-write-password --set secrets.productLogIngestToken=test-product-log-token >"${OUTPUT_DIR}/full.yaml"
helm template compartment "${CHART_DIR}" -f "${CHART_DIR}/values-kind.yaml" >"${OUTPUT_DIR}/kind.yaml"
helm template compartment "${CHART_DIR}" --set platform.startupStage=full --set platform.installationId=test-install --set platform.baseDomain=apps.example.com --set platform.publicProtocol=https --set platform.publicIngressIpv4=8.8.8.8 --set secrets.registryWritePassword=test-write-password --set secrets.productLogIngestToken=test-product-log-token --set edge.snapshots.enabled=true >"${OUTPUT_DIR}/edge.yaml"
helm template compartment "${CHART_DIR}" --set platform.startupStage=full --set platform.installationId=test-managed --set platform.domainMode=managed --set platform.baseDomain=managed.compartment.run --set platform.publicProtocol=https --set platform.tlsMode=managed --set platform.publicIngressIpv4=8.8.4.4 --set platform.acmeEmail=admin@example.com --set secrets.managedDomainBrokerToken=broker-token --set secrets.registryWritePassword=test-write-password --set secrets.productLogIngestToken=test-product-log-token >"${OUTPUT_DIR}/managed.yaml"
helm template compartment "${CHART_DIR}" --set platform.startupStage=full --set platform.installationId=test-custom --set platform.baseDomain=apps.example.com --set platform.publicProtocol=https --set platform.tlsMode=custom-cert --set platform.publicIngressIpv4=8.8.8.8 --set platform.acmeEmail=admin@example.com --set customTls.existingSecret=operator-tls --set secrets.registryWritePassword=test-write-password --set secrets.productLogIngestToken=test-product-log-token >"${OUTPUT_DIR}/custom-cert.yaml"
helm template compartment "${CHART_DIR}" --set platform.startupStage=full --set platform.installationId=test-pending --set platform.domainMode=managed --set platform.baseDomain=managed.compartment.run --set platform.publicProtocol=https --set platform.tlsMode=managed --set platform.publicIngressIpv4=8.8.4.4 --set platform.acmeEmail=admin@example.com --set secrets.managedDomainBrokerToken=broker-token --set customTls.pendingSecretName=operator-tls --set-string customTls.pendingCertificate=test-certificate --set-string customTls.pendingPrivateKey=test-private-key --set customTls.pendingOperationId=domop_123 --set secrets.registryWritePassword=test-write-password --set secrets.productLogIngestToken=test-product-log-token >"${OUTPUT_DIR}/pending-custom-cert.yaml"
helm template compartment "${CHART_DIR}" --set platform.startupStage=full --set platform.installationId=test-rotation --set platform.baseDomain=apps.example.com --set platform.publicProtocol=https --set platform.tlsMode=custom-cert --set platform.publicIngressIpv4=8.8.8.8 --set platform.acmeEmail=admin@example.com --set customTls.existingSecret=active-operator-tls --set customTls.operatorSecretName=active-operator-tls --set-string customTls.operatorCertificate=active-certificate --set-string customTls.operatorPrivateKey=active-private-key --set customTls.pendingSecretName=pending-operator-tls --set-string customTls.pendingCertificate=pending-certificate --set-string customTls.pendingPrivateKey=pending-private-key --set customTls.pendingOperationId=domop_456 --set secrets.registryWritePassword=test-write-password --set secrets.productLogIngestToken=test-product-log-token >"${OUTPUT_DIR}/rotating-custom-cert.yaml"
helm template compartment "${CHART_DIR}" --set platform.startupStage=full --set platform.installationId=test-rotation --set platform.baseDomain=apps.example.com --set platform.publicProtocol=https --set platform.tlsMode=custom-cert --set platform.publicIngressIpv4=8.8.8.8 --set platform.acmeEmail=admin@example.com --set customTls.existingSecret=active-operator-tls --set customTls.operatorSecretName=active-operator-tls --set-string customTls.operatorCertificate=active-certificate --set-string customTls.operatorPrivateKey=active-private-key --set secrets.registryWritePassword=test-write-password --set secrets.productLogIngestToken=test-product-log-token >"${OUTPUT_DIR}/rotation-active-custom-cert.yaml"
helm template compartment "${CHART_DIR}" --set platform.startupStage=full --set platform.installationId=test-inline-custom --set platform.baseDomain=apps.example.com --set platform.publicProtocol=https --set platform.tlsMode=custom-cert --set platform.publicIngressIpv4=8.8.8.8 --set platform.acmeEmail=admin@example.com --set-string customTls.certificate=test-certificate --set-string customTls.privateKey=test-private-key --set secrets.registryWritePassword=test-write-password --set secrets.productLogIngestToken=test-product-log-token >"${OUTPUT_DIR}/custom-cert-inline.yaml"
helm template compartment "${CHART_DIR}" --set platform.startupStage=full --set platform.installationId=test-inline-custom --set platform.baseDomain=apps.example.com --set platform.publicProtocol=https --set platform.tlsMode=custom-cert --set platform.publicIngressIpv4=8.8.8.8 --set platform.acmeEmail=admin@example.com --set-string customTls.certificate=rotated-certificate --set-string customTls.privateKey=test-private-key --set secrets.registryWritePassword=test-write-password --set secrets.productLogIngestToken=test-product-log-token >"${OUTPUT_DIR}/custom-cert-inline-rotated.yaml"
helm template compartment "${CHART_DIR}" --set fullnameOverride=renamed-compartment >"${OUTPUT_DIR}/renamed-foundation.yaml"
node "${CHART_DIR}/test/assert-project-provisioning-rbac.mjs" "${OUTPUT_DIR}/full.yaml"
node "${CHART_DIR}/test/assert-operator-docs.mjs"

if helm template compartment "${CHART_DIR}" --kube-version 1.29.9 --set platform.startupStage=full --set platform.installationId=test-install --set secrets.registryWritePassword=test-write-password --set secrets.productLogIngestToken=test-product-log-token >/dev/null 2>&1; then
  echo 'Chart must fail closed on Kubernetes versions without admissionregistration.k8s.io/v1 ValidatingAdmissionPolicy.' >&2
  exit 1
fi

if helm template compartment "${CHART_DIR}" --set platform.startupStage=full --set platform.installationId=test-managed --set platform.domainMode=managed --set platform.baseDomain=managed.compartment.run --set platform.publicProtocol=https --set platform.tlsMode=managed --set platform.publicIngressIpv4=8.8.4.4 --set platform.acmeEmail=admin@example.com --set secrets.registryWritePassword=test-write-password --set secrets.productLogIngestToken=test-product-log-token >/dev/null 2>&1; then
  echo 'Managed TLS must require the broker token.' >&2
  exit 1
fi

if helm template compartment "${CHART_DIR}" --set platform.startupStage=full --set platform.installationId=test-managed --set platform.domainMode=managed --set platform.baseDomain=managed.compartment.run --set platform.publicProtocol=https --set platform.tlsMode=managed --set platform.publicIngressIpv4=8.8.4.4 --set platform.acmeEmail=admin@example.com --set-string platform.managedDomainBrokerUrl= --set secrets.managedDomainBrokerToken=broker-token --set secrets.registryWritePassword=test-write-password --set secrets.productLogIngestToken=test-product-log-token >/dev/null 2>&1; then
  echo 'Managed TLS must require the broker URL.' >&2
  exit 1
fi

if helm template compartment "${CHART_DIR}" --set platform.startupStage=full --set platform.installationId=test-private-ingress --set platform.baseDomain=apps.example.com --set platform.publicProtocol=https --set platform.publicIngressIpv4=10.0.0.1 --set secrets.registryWritePassword=test-write-password --set secrets.productLogIngestToken=test-product-log-token >/dev/null 2>&1; then
  echo 'Public installations must reject private ingress addresses.' >&2
  exit 1
fi

if helm template compartment "${CHART_DIR}" --set platform.startupStage=full --set platform.installationId=test-invalid-ingress --set platform.baseDomain=apps.example.com --set platform.publicProtocol=https --set platform.publicIngressIpv4=not-an-ip --set secrets.registryWritePassword=test-write-password --set secrets.productLogIngestToken=test-product-log-token >/dev/null 2>&1; then
  echo 'Public installations must reject malformed ingress addresses.' >&2
  exit 1
fi

if helm template compartment "${CHART_DIR}" --set platform.startupStage=full --set platform.installationId=test-loopback-ingress --set platform.baseDomain=apps.example.com --set platform.publicProtocol=https --set platform.publicIngressIpv6=0:0:0:0:0:0:0:1 --set secrets.registryWritePassword=test-write-password --set secrets.productLogIngestToken=test-product-log-token >/dev/null 2>&1; then
  echo 'Public installations must reject expanded IPv6 loopback addresses.' >&2
  exit 1
fi

if helm template compartment "${CHART_DIR}" --set platform.startupStage=full --set platform.installationId=test-mixed-loopback-ingress --set platform.baseDomain=apps.example.com --set platform.publicProtocol=https --set platform.publicIngressIpv6=::0.0.0.1 --set secrets.registryWritePassword=test-write-password --set secrets.productLogIngestToken=test-product-log-token >/dev/null 2>&1; then
  echo 'Public installations must reject mixed-notation IPv6 loopback addresses.' >&2
  exit 1
fi

if helm template compartment "${CHART_DIR}" --set platform.startupStage=full --set platform.installationId=test-mixed-unspecified-ingress --set platform.baseDomain=apps.example.com --set platform.publicProtocol=https --set platform.publicIngressIpv6=::0.0.0.0 --set secrets.registryWritePassword=test-write-password --set secrets.productLogIngestToken=test-product-log-token >/dev/null 2>&1; then
  echo 'Public installations must reject mixed-notation IPv6 unspecified addresses.' >&2
  exit 1
fi

if helm template compartment "${CHART_DIR}" --set platform.startupStage=full --set platform.installationId=test-documentation-ingress --set platform.baseDomain=apps.example.com --set platform.publicProtocol=https --set platform.publicIngressIpv6=2001:0db8::1 --set secrets.registryWritePassword=test-write-password --set secrets.productLogIngestToken=test-product-log-token >/dev/null 2>&1; then
  echo 'Public installations must reject expanded IPv6 documentation addresses.' >&2
  exit 1
fi

if helm template compartment "${CHART_DIR}" --set platform.startupStage=full --set platform.installationId=test-managed --set platform.domainMode=managed --set platform.baseDomain=managed.compartment.run --set platform.publicProtocol=https --set platform.tlsMode=managed --set platform.publicIngressIpv4=8.8.4.4 --set platform.acmeCaUrl=http://acme.example.com/directory --set platform.acmeEmail=admin@example.com --set secrets.managedDomainBrokerToken=broker-token --set secrets.registryWritePassword=test-write-password --set secrets.productLogIngestToken=test-product-log-token >/dev/null 2>&1; then
  echo 'Managed TLS must reject a non-HTTPS ACME CA URL.' >&2
  exit 1
fi

if helm template compartment "${CHART_DIR}" --set platform.startupStage=full --set platform.installationId=test-managed --set platform.domainMode=managed --set platform.baseDomain=managed.compartment.run --set platform.publicProtocol=https --set platform.tlsMode=managed --set platform.publicIngressIpv4=8.8.4.4 --set-string 'platform.acmeCaUrl=https://?' --set platform.acmeEmail=admin@example.com --set secrets.managedDomainBrokerToken=broker-token --set secrets.registryWritePassword=test-write-password --set secrets.productLogIngestToken=test-product-log-token >/dev/null 2>&1; then
  echo 'Managed TLS must reject an ACME CA URL without a host.' >&2
  exit 1
fi

if helm template compartment "${CHART_DIR}" --set platform.startupStage=full --set platform.installationId=test-managed --set platform.domainMode=managed --set platform.baseDomain=managed.compartment.run --set platform.publicProtocol=https --set platform.tlsMode=managed --set platform.publicIngressIpv4=8.8.4.4 --set platform.acmeEmail=admin@example.com --set platform.managedDomainBrokerUrl=not-a-url --set secrets.managedDomainBrokerToken=broker-token --set secrets.registryWritePassword=test-write-password --set secrets.productLogIngestToken=test-product-log-token >/dev/null 2>&1; then
  echo 'Managed TLS must reject a malformed broker URL.' >&2
  exit 1
fi

if helm template compartment "${CHART_DIR}" --set platform.startupStage=full --set platform.installationId=test-managed --set platform.domainMode=managed --set platform.baseDomain=managed.compartment.run --set platform.publicProtocol=https --set platform.tlsMode=managed --set platform.publicIngressIpv4=8.8.4.4 --set platform.acmeEmail=not-an-email --set secrets.managedDomainBrokerToken=broker-token --set secrets.registryWritePassword=test-write-password --set secrets.productLogIngestToken=test-product-log-token >/dev/null 2>&1; then
  echo 'Managed TLS must reject a malformed ACME email.' >&2
  exit 1
fi

if helm template compartment "${CHART_DIR}" --set platform.startupStage=full --set platform.installationId=test-custom --set platform.baseDomain=apps.example.com --set platform.publicProtocol=https --set platform.tlsMode=custom-cert --set platform.publicIngressIpv4=8.8.8.8 --set customTls.existingSecret=operator-tls --set secrets.registryWritePassword=test-write-password --set secrets.productLogIngestToken=test-product-log-token >/dev/null 2>&1; then
  echo 'Custom-certificate TLS must require an ACME email for tenant certificates.' >&2
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
grep -A2 -q 'name: COMPARTMENT_INSTALL_TOKEN' "${OUTPUT_DIR}/full.yaml"
grep -q 'key: install-token' "${OUTPUT_DIR}/full.yaml"
grep -q 'port: 80' "${OUTPUT_DIR}/full.yaml"
grep -q 'port: 443' "${OUTPUT_DIR}/full.yaml"
grep -q 'containerPort: 8080' "${OUTPUT_DIR}/full.yaml"
grep -q 'containerPort: 8443' "${OUTPUT_DIR}/full.yaml"
grep -q 'COMPARTMENT_PUBLIC_HTTP_PORT: "80"' "${OUTPUT_DIR}/full.yaml"
grep -q 'COMPARTMENT_PUBLIC_HTTPS_PORT: "443"' "${OUTPUT_DIR}/full.yaml"
grep -q 'COMPARTMENT_CADDY_HTTP_PORT: "8080"' "${OUTPUT_DIR}/full.yaml"
grep -q 'COMPARTMENT_CADDY_HTTPS_PORT: "8443"' "${OUTPUT_DIR}/full.yaml"
grep -q 'COMPARTMENT_ACME_ISSUER: "acme"' "${OUTPUT_DIR}/managed.yaml"
grep -q 'COMPARTMENT_MANAGED_DOMAIN_BROKER_URL: "https://broker.compartment.run"' "${OUTPUT_DIR}/managed.yaml"
grep -q 'key: managed-domain-broker-token' "${OUTPUT_DIR}/managed.yaml"
awk 'BEGIN { RS="---" } /kind: Secret/ && /name: compartment-install-state/ { print }' "${OUTPUT_DIR}/managed.yaml" >"${OUTPUT_DIR}/install-state-secret.yaml"
awk 'BEGIN { RS="---" } /kind: Secret/ && /name: compartment-compartment$/ { print }' "${OUTPUT_DIR}/managed.yaml" >"${OUTPUT_DIR}/platform-secret.yaml"
awk 'BEGIN { RS="---" } /kind: Deployment/ && /name: compartment-compartment-api/ { print }' "${OUTPUT_DIR}/managed.yaml" >"${OUTPUT_DIR}/api-deployment.yaml"
awk 'BEGIN { RS="---" } /kind: Deployment/ && /name: compartment-compartment-caddy/ { print }' "${OUTPUT_DIR}/managed.yaml" >"${OUTPUT_DIR}/caddy-deployment.yaml"
grep -q 'helm.sh/resource-policy: keep' "${OUTPUT_DIR}/install-state-secret.yaml"
grep -q 'managed-domain-broker-token: "broker-token"' "${OUTPUT_DIR}/install-state-secret.yaml"
grep -q 'managed-base-domain: "managed.compartment.run"' "${OUTPUT_DIR}/install-state-secret.yaml"
grep -q 'domain-generation: "0"' "${OUTPUT_DIR}/install-state-secret.yaml"
if grep -q 'managed-domain-broker-token' "${OUTPUT_DIR}/platform-secret.yaml"; then
  echo 'Managed-domain broker token must be owned only by the retained install-state Secret.' >&2
  exit 1
fi
grep -A2 -q 'name: COMPARTMENT_MANAGED_DOMAIN_BROKER_TOKEN' "${OUTPUT_DIR}/api-deployment.yaml"
grep -q 'name: compartment-install-state' "${OUTPUT_DIR}/api-deployment.yaml"
grep -A2 -q 'name: COMPARTMENT_MANAGED_DOMAIN_BROKER_TOKEN' "${OUTPUT_DIR}/caddy-deployment.yaml"
grep -q 'name: compartment-install-state' "${OUTPUT_DIR}/caddy-deployment.yaml"
if grep -q 'secretName: compartment-compartment-custom-tls' "${OUTPUT_DIR}/managed.yaml"; then
  echo 'Managed TLS workloads must not mount the custom-certificate Secret.' >&2
  exit 1
fi
if sed -n '/^kind: ConfigMap$/,/^---$/p' "${OUTPUT_DIR}/managed.yaml" | grep -q 'broker-token'; then
  echo 'Managed-domain broker token must not be rendered in a ConfigMap.' >&2
  exit 1
fi
test "$(grep -c 'secretName: operator-tls' "${OUTPUT_DIR}/custom-cert.yaml")" -eq 2
awk 'BEGIN { RS="---" } /kind: Deployment/ && /name: compartment-compartment-api/ { print }' "${OUTPUT_DIR}/pending-custom-cert.yaml" >"${OUTPUT_DIR}/pending-custom-cert-api.yaml"
awk 'BEGIN { RS="---" } /kind: Deployment/ && /name: compartment-compartment-caddy/ { print }' "${OUTPUT_DIR}/pending-custom-cert.yaml" >"${OUTPUT_DIR}/pending-custom-cert-caddy.yaml"
grep -q 'secretName: operator-tls' "${OUTPUT_DIR}/pending-custom-cert-api.yaml"
grep -q 'mountPath: "/etc/compartment/tls/domop_123"' "${OUTPUT_DIR}/pending-custom-cert-api.yaml"
grep -q '{key: tls.crt, path: fullchain.pem}' "${OUTPUT_DIR}/pending-custom-cert-api.yaml"
grep -q '{key: tls.key, path: privkey.pem}' "${OUTPUT_DIR}/pending-custom-cert-api.yaml"
if grep -q 'secretName: operator-tls' "${OUTPUT_DIR}/pending-custom-cert-caddy.yaml"; then
  echo 'Pending certificate material must be mounted only by the API deployment.' >&2
  exit 1
fi
awk 'BEGIN { RS="---" } /kind: Deployment/ && /name: compartment-compartment-api/ { print }' "${OUTPUT_DIR}/rotating-custom-cert.yaml" >"${OUTPUT_DIR}/rotating-custom-cert-api.yaml"
awk 'BEGIN { RS="---" } /kind: Deployment/ && /name: compartment-compartment-caddy/ { print }' "${OUTPUT_DIR}/rotating-custom-cert.yaml" >"${OUTPUT_DIR}/rotating-custom-cert-caddy.yaml"
awk 'BEGIN { RS="---" } /kind: Deployment/ && /name: compartment-compartment-api/ { print }' "${OUTPUT_DIR}/rotation-active-custom-cert.yaml" >"${OUTPUT_DIR}/rotation-active-custom-cert-api.yaml"
awk 'BEGIN { RS="---" } /kind: Deployment/ && /name: compartment-compartment-caddy/ { print }' "${OUTPUT_DIR}/rotation-active-custom-cert.yaml" >"${OUTPUT_DIR}/rotation-active-custom-cert-caddy.yaml"
grep -q 'secretName: active-operator-tls' "${OUTPUT_DIR}/rotating-custom-cert-api.yaml"
grep -q 'secretName: pending-operator-tls' "${OUTPUT_DIR}/rotating-custom-cert-api.yaml"
grep -q 'secretName: active-operator-tls' "${OUTPUT_DIR}/rotating-custom-cert-caddy.yaml"
if grep -q 'secretName: pending-operator-tls' "${OUTPUT_DIR}/rotating-custom-cert-caddy.yaml"; then
  echo 'Caddy must keep the active certificate while a replacement is pending.' >&2
  exit 1
fi
test "$(grep -m1 'checksum/custom-tls:' "${OUTPUT_DIR}/rotation-active-custom-cert-caddy.yaml")" = "$(grep -m1 'checksum/custom-tls:' "${OUTPUT_DIR}/rotating-custom-cert-caddy.yaml")"
test "$(grep -m1 'checksum/pending-tls:' "${OUTPUT_DIR}/rotation-active-custom-cert-api.yaml")" != "$(grep -m1 'checksum/pending-tls:' "${OUTPUT_DIR}/rotating-custom-cert-api.yaml")"
grep -q 'compartment.dev/pending-domain-operation: "domop_123"' "${OUTPUT_DIR}/pending-custom-cert-api.yaml"
for workload in caddy edge worker project-provisioner; do
  awk -v workload="compartment-compartment-${workload}" 'BEGIN { RS="---" } /kind: Deployment/ && $0 ~ "name: " workload "($|\\n)" { print }' "${OUTPUT_DIR}/pending-custom-cert.yaml" >"${OUTPUT_DIR}/pending-${workload}.yaml"
  if grep -q 'compartment.dev/pending-domain-operation' "${OUTPUT_DIR}/pending-${workload}.yaml"; then
    echo "Pending domain rollout must not restart ${workload}." >&2
    exit 1
  fi
done
awk 'BEGIN { RS="---" } /kind: Deployment/ && /name: compartment-compartment-api/ { print }' "${OUTPUT_DIR}/custom-cert.yaml" >"${OUTPUT_DIR}/custom-cert-api.yaml"
awk 'BEGIN { RS="---" } /kind: Deployment/ && /name: compartment-compartment-caddy/ { print }' "${OUTPUT_DIR}/custom-cert.yaml" >"${OUTPUT_DIR}/custom-cert-caddy.yaml"
for workload in custom-cert-api custom-cert-caddy; do
  grep -q 'secretName: operator-tls' "${OUTPUT_DIR}/${workload}.yaml"
  grep -q '{key: tls.crt, path: fullchain.pem}' "${OUTPUT_DIR}/${workload}.yaml"
  grep -q '{key: tls.key, path: privkey.pem}' "${OUTPUT_DIR}/${workload}.yaml"
done
grep -q '{name: active-tls, mountPath: /etc/compartment/tls, readOnly: true}' "${OUTPUT_DIR}/custom-cert-api.yaml"
grep -q '{name: tls, mountPath: /etc/compartment/tls, readOnly: true}' "${OUTPUT_DIR}/custom-cert-caddy.yaml"
grep -q '{key: tls.crt, path: fullchain.pem}' "${OUTPUT_DIR}/custom-cert.yaml"
grep -q '{key: tls.key, path: privkey.pem}' "${OUTPUT_DIR}/custom-cert.yaml"
grep -q 'COMPARTMENT_CUSTOM_TLS_CERT_FILE: /etc/compartment/tls/fullchain.pem' "${OUTPUT_DIR}/custom-cert.yaml"
grep -q 'COMPARTMENT_CUSTOM_TLS_KEY_FILE: /etc/compartment/tls/privkey.pem' "${OUTPUT_DIR}/custom-cert.yaml"
awk 'BEGIN { RS="---" } /kind: Secret/ && /name: compartment-compartment-custom-tls/ { print }' "${OUTPUT_DIR}/custom-cert-inline.yaml" >"${OUTPUT_DIR}/inline-custom-tls-secret.yaml"
grep -q 'tls.crt: "test-certificate"' "${OUTPUT_DIR}/inline-custom-tls-secret.yaml"
grep -q 'tls.key: "test-private-key"' "${OUTPUT_DIR}/inline-custom-tls-secret.yaml"
test "$(grep -c 'secretName: compartment-compartment-custom-tls' "${OUTPUT_DIR}/custom-cert-inline.yaml")" -eq 2
test "$(grep -m1 'checksum/custom-tls:' "${OUTPUT_DIR}/custom-cert-inline.yaml")" != "$(grep -m1 'checksum/custom-tls:' "${OUTPUT_DIR}/custom-cert-inline-rotated.yaml")"
grep -q 'name: compartment-install-state' "${OUTPUT_DIR}/renamed-foundation.yaml"
if grep -q 'name: renamed-compartment-install-state' "${OUTPUT_DIR}/renamed-foundation.yaml"; then
  echo 'The retained install-state Secret name must not depend on chart naming overrides.' >&2
  exit 1
fi
grep -q 'value: "ghcr.io/compartmentdev/compartment-worker:latest"' "${OUTPUT_DIR}/full.yaml"
grep -q '\\"compartment-compartment-registry-auth.default.svc:5000\\"' "${OUTPUT_DIR}/full.yaml"
grep -q 'name: compartment-compartment-project-provisioner' "${OUTPUT_DIR}/full.yaml"
grep -q 'command:.*project-provisioner-server.js' "${OUTPUT_DIR}/full.yaml"
for workload in worker project-provisioner; do
  awk -v workload="compartment-compartment-${workload}" 'BEGIN { RS="---" } /kind: Deployment/ && $0 ~ "name: " workload "($|\\n)" { print }' "${OUTPUT_DIR}/full.yaml" >"${OUTPUT_DIR}/${workload}-deployment.yaml"
  migration_wait_line="$(grep -n 'name: wait-for-api-migrate' "${OUTPUT_DIR}/${workload}-deployment.yaml" | cut -d: -f1)"
  api_rollout_wait_line="$(grep -n 'name: wait-for-api-rollout' "${OUTPUT_DIR}/${workload}-deployment.yaml" | cut -d: -f1)"
  api_wait_line="$(grep -n 'name: wait-for-api$' "${OUTPUT_DIR}/${workload}-deployment.yaml" | cut -d: -f1)"
  test -n "${migration_wait_line}"
  test -n "${api_rollout_wait_line}"
  test -n "${api_wait_line}"
  test "${migration_wait_line}" -lt "${api_rollout_wait_line}"
  test "${api_rollout_wait_line}" -lt "${api_wait_line}"
  grep -q -- '- rollout' "${OUTPUT_DIR}/${workload}-deployment.yaml"
  grep -q -- '- status' "${OUTPUT_DIR}/${workload}-deployment.yaml"
  grep -q 'deployment/compartment-compartment-api' "${OUTPUT_DIR}/${workload}-deployment.yaml"
  grep -q 'COMPARTMENT_API_INTERNAL_HOST.*COMPARTMENT_API_PORT.*readyz' "${OUTPUT_DIR}/${workload}-deployment.yaml"
done
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
grep -q 'kind: Service' "${OUTPUT_DIR}/foundation.yaml"
grep -q 'app.kubernetes.io/component: caddy' "${OUTPUT_DIR}/foundation.yaml"
if grep -q 'nodePort:' "${OUTPUT_DIR}/full.yaml"; then
  echo 'The default public LoadBalancer Service must not pin NodePorts.' >&2
  exit 1
fi
grep -q 'nodePort: 30080' "${OUTPUT_DIR}/kind.yaml"
grep -q 'nodePort: 30443' "${OUTPUT_DIR}/kind.yaml"
if grep -q 'name: compartment-compartment-caddy' "${OUTPUT_DIR}/foundation.yaml" && grep -q 'kind: Deployment' "${OUTPUT_DIR}/foundation.yaml"; then
  if sed -n '/^kind: Deployment$/,/^---$/p' "${OUTPUT_DIR}/foundation.yaml" | grep -q 'name: compartment-compartment-caddy'; then
    echo 'Foundation stage must allocate the Caddy Service without starting Caddy.' >&2
    exit 1
  fi
fi
if grep -q 'compartment-compartment-edge-snapshots' "${OUTPUT_DIR}/full.yaml"; then
  echo 'Edge snapshot storage must be disabled by default.' >&2
  exit 1
fi
if grep -q 'app.kubernetes.io/component: buildkit' "${OUTPUT_DIR}/kind.yaml"; then
  echo 'Restricted profile unexpectedly rendered BuildKit.' >&2
  exit 1
fi
