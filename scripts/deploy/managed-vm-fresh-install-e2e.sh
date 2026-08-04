#!/usr/bin/env bash
set -euo pipefail

readonly cli_path="${1:?Usage: managed-vm-fresh-install-e2e.sh <compartment-cli>}"
readonly expected_gvisor_version="release-20260721.0"
readonly password_file="$(mktemp)"
readonly install_log="$(mktemp)"
readonly canary_manifest="$(mktemp)"

cleanup() {
  rm -f "${password_file}" "${install_log}" "${canary_manifest}"
  sudo k3s kubectl delete pod/compartment-fresh-vm-gvisor-e2e \
    --namespace default \
    --ignore-not-found \
    --wait=false >/dev/null 2>&1 || true
}
trap cleanup EXIT

for forbidden_path in \
  /etc/rancher/k3s \
  /var/lib/rancher/k3s \
  /var/lib/compartment/installer \
  /usr/local/bin/k3s \
  /usr/local/bin/runsc \
  /usr/local/bin/containerd-shim-runsc-v1; do
  if sudo test -e "${forbidden_path}"; then
    echo "Fresh-VM precondition failed: ${forbidden_path} already exists." >&2
    exit 1
  fi
done

if systemctl list-unit-files k3s.service --no-legend 2>/dev/null | grep -q '^k3s.service'; then
  echo 'Fresh-VM precondition failed: k3s.service is already registered.' >&2
  exit 1
fi

umask 077
openssl rand -base64 36 >"${password_file}"

"${cli_path}" install \
  --target vm \
  --yes \
  --email owner@managed-vm-e2e.test \
  --organization 'Managed VM E2E' \
  --admin-password-file "${password_file}" 2>&1 | tee "${install_log}"

grep -q 'installing-sandbox-runtime' "${install_log}"
sudo /usr/local/bin/runsc --version | grep -q "${expected_gvisor_version}"
sudo grep -q 'io.containerd.runsc.v1' /var/lib/rancher/k3s/agent/etc/containerd/config.toml
sudo grep -q '/etc/containerd/runsc.toml' /var/lib/rancher/k3s/agent/etc/containerd/config.toml
test "$(sudo k3s kubectl get runtimeclass/gvisor --output=jsonpath='{.handler}')" = 'runsc'

cat >"${canary_manifest}" <<'EOF'
apiVersion: v1
kind: Pod
metadata:
  name: compartment-fresh-vm-gvisor-e2e
  namespace: default
spec:
  automountServiceAccountToken: false
  restartPolicy: Never
  runtimeClassName: gvisor
  containers:
    - name: canary
      image: postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777
      command: [sh, -c]
      args: [sleep 300]
      securityContext:
        allowPrivilegeEscalation: false
        capabilities:
          drop: [ALL]
EOF

sudo k3s kubectl apply --filename "${canary_manifest}"
sudo k3s kubectl wait pod/compartment-fresh-vm-gvisor-e2e --for=condition=Ready --timeout=5m
sudo k3s kubectl exec pod/compartment-fresh-vm-gvisor-e2e -- dmesg | grep -qi gvisor

echo 'Verified fresh managed-VM installation with gVisor fail-closed sandboxing.'
