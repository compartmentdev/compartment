#!/usr/bin/env bash
set -euo pipefail

script_directory="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly script_directory
readonly metadata_path="${script_directory}/../../packages/cli/src/services/kubernetes-install-compatibility.json"
stage="$(mktemp -d /tmp/compartment-worker-image.XXXXXX)"
readonly stage

cleanup() {
  rm -rf -- "${stage}"
}
trap cleanup EXIT

test "$(uname -m)" = x86_64
test "$(id -u)" -eq 0
test -r "${metadata_path}"
# shellcheck source=/dev/null
source /etc/os-release
test "${ID:-}" = ubuntu
test "${VERSION_ID:-}" = 24.04
for forbidden_path in \
  /etc/compartment-worker \
  /etc/compartment-worker-image \
  /etc/containerd \
  /etc/default/k3s-agent \
  /etc/rancher/k3s \
  /etc/systemd/system/k3s-agent.service \
  /etc/systemd/system/k3s-agent.service.d \
  /var/lib/rancher/k3s \
  /usr/local/bin/k3s \
  /usr/local/bin/runsc \
  /usr/local/bin/containerd-shim-runsc-v1 \
  /usr/local/bin/gvisor-bin \
  /usr/local/sbin/compartment-clean-orphan-runsc-shims \
  /usr/local/sbin/compartment-worker-join \
  /usr/local/sbin/compartment-worker-preflight; do
  test ! -e "${forbidden_path}"
done
for forbidden_unit in containerd.service k3s.service k3s-agent.service; do
  if systemctl list-unit-files "${forbidden_unit}" --no-legend 2>/dev/null | grep --quiet "^${forbidden_unit}"; then
    echo "Worker image preparation requires a pristine image without ${forbidden_unit}." >&2
    exit 1
  fi
done

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl jq

k3s_version="$(jq --exit-status --raw-output '.managed.k3s.version' "${metadata_path}")"
readonly k3s_version
k3s_sha256="$(jq --exit-status --raw-output '.managed.k3s.sha256' "${metadata_path}")"
readonly k3s_sha256
k3s_url="$(jq --exit-status --raw-output '.managed.k3s.url' "${metadata_path}")"
readonly k3s_url
containerd_version="$(jq --exit-status --raw-output '.managed.containerdVersion' "${metadata_path}")"
readonly containerd_version
gvisor_version="$(jq --exit-status --raw-output '.managed.gvisor.version' "${metadata_path}")"
readonly gvisor_version
gvisor_sha256="$(jq --exit-status --raw-output '.managed.gvisor.sha256' "${metadata_path}")"
readonly gvisor_sha256
gvisor_sha512="$(jq --exit-status --raw-output '.managed.gvisor.sha512' "${metadata_path}")"
readonly gvisor_sha512
gvisor_url="$(jq --exit-status --raw-output '.managed.gvisor.url' "${metadata_path}")"
readonly gvisor_url

curl --fail --silent --show-error --location --retry 8 --retry-all-errors --retry-delay 2 \
  "${k3s_url}" \
  --output "${stage}/k3s"
printf '%s  %s\n' "${k3s_sha256}" "${stage}/k3s" | sha256sum --check --strict
install -m 0755 "${stage}/k3s" /usr/local/bin/k3s

curl --fail --silent --show-error --location --retry 8 --retry-all-errors --retry-delay 2 \
  "${gvisor_url}" \
  --output "${stage}/runsc.deb"
printf '%s  %s\n' "${gvisor_sha256}" "${stage}/runsc.deb" | sha256sum --check --strict
printf '%s  %s\n' "${gvisor_sha512}" "${stage}/runsc.deb" | sha512sum --check --strict
dpkg-deb --extract "${stage}/runsc.deb" "${stage}/gvisor"

install -m 0755 "${stage}/gvisor/usr/bin/runsc" /usr/local/bin/runsc
install -m 0755 "${stage}/gvisor/usr/bin/containerd-shim-runsc-v1" /usr/local/bin/containerd-shim-runsc-v1
install -d -m 0755 \
  /usr/local/bin/gvisor-bin \
  /etc/containerd \
  /etc/systemd/system/k3s-agent.service.d \
  /var/lib/rancher/k3s/agent/etc/containerd
install -m 0755 "${stage}/gvisor/usr/bin/gvisor-bin/checkpointgofer" /usr/local/bin/gvisor-bin/checkpointgofer
install -m 0755 "${stage}/gvisor/usr/bin/gvisor-bin/runsc-metric-server" /usr/local/bin/gvisor-bin/runsc-metric-server
install -m 0600 "${stage}/gvisor/etc/containerd/runsc.toml" /etc/containerd/runsc.toml

cat >/var/lib/rancher/k3s/agent/etc/containerd/config-v3.toml.tmpl <<'EOF'
{{ template "base" . }}

[plugins.'io.containerd.cri.v1.runtime'.containerd.runtimes.runsc]
  runtime_type = "io.containerd.runsc.v1"
  pod_annotations = ["dev.gvisor.spec.mount.*"]

[plugins.'io.containerd.cri.v1.runtime'.containerd.runtimes.runsc.options]
  TypeUrl = "io.containerd.runsc.v1.options"
  ConfigPath = "/etc/containerd/runsc.toml"
EOF

cat >/etc/systemd/system/k3s-agent.service <<'EOF'
[Unit]
Description=Lightweight Kubernetes Agent
Documentation=https://k3s.io
Wants=network-online.target
After=network-online.target

[Install]
WantedBy=multi-user.target

[Service]
Type=notify
NotifyAccess=all
KillMode=process
Delegate=yes
LimitNOFILE=1048576
LimitNPROC=infinity
LimitCORE=infinity
TasksMax=infinity
TimeoutStartSec=0
TimeoutStopSec=90s
Restart=always
RestartSec=5s
ExecStartPre=/usr/local/sbin/compartment-worker-preflight
ExecStart=/usr/local/bin/k3s agent
EOF

cat >/etc/systemd/system/k3s-agent.service.d/compartment.conf <<'EOF'
[Service]
EnvironmentFile=/etc/default/k3s-agent
KillMode=process
ExecStartPost=-/usr/local/sbin/compartment-clean-orphan-runsc-shims
EOF

cat >/usr/local/sbin/compartment-worker-preflight <<EOF
#!/usr/bin/env bash
set -euo pipefail
test "\$(uname -m)" = x86_64
/usr/local/bin/k3s --version | grep --fixed-strings '${k3s_version}'
/usr/local/bin/runsc --version | grep --fixed-strings '${gvisor_version}'
test -x /usr/local/bin/containerd-shim-runsc-v1
test -r /etc/default/k3s-agent
test ! -e /var/lib/rancher/k3s/agent/etc/containerd/config.toml || \
  grep --fixed-strings 'runtime_type = "io.containerd.runsc.v1"' \
    /var/lib/rancher/k3s/agent/etc/containerd/config.toml
EOF
chmod 0755 /usr/local/sbin/compartment-worker-preflight

cat >/usr/local/sbin/compartment-clean-orphan-runsc-shims <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

declare -A candidates=()

task_ids() {
  local attempt
  for ((attempt = 1; attempt <= 10; attempt += 1)); do
    if /usr/local/bin/k3s ctr --namespace k8s.io tasks list --quiet; then
      return
    fi
    sleep 1
  done
  return 1
}

shim_argument() {
  local pid="$1"
  local requested_argument="$2"
  local -a arguments=()
  local index
  mapfile -d '' -t arguments <"/proc/${pid}/cmdline"
  for ((index = 0; index < ${#arguments[@]}; index += 1)); do
    if [[ "${arguments[index]}" = "${requested_argument}" && -n "${arguments[index + 1]:-}" ]]; then
      printf '%s\n' "${arguments[index + 1]}"
      return
    fi
  done
  return 1
}

is_owned_shim() {
  local pid="$1"
  local executable namespace
  executable="$(readlink "/proc/${pid}/exe" 2>/dev/null || true)"
  namespace="$(shim_argument "${pid}" -namespace 2>/dev/null || true)"
  [[ "${executable##*/}" = containerd-shim-runsc-v1 ]] && \
    [[ "${namespace}" = k8s.io ]] && \
    grep --fixed-strings --quiet '/system.slice/k3s-agent.service' "/proc/${pid}/cgroup" 2>/dev/null
}

find_orphans() {
  local tasks="$1"
  local process id
  for process in /proc/[0-9]*; do
    is_owned_shim "${process##*/}" || continue
    id="$(shim_argument "${process##*/}" -id || true)"
    [[ -n "${id}" ]] || continue
    if ! grep --fixed-strings --line-regexp --quiet "${id}" <<<"${tasks}"; then
      candidates["${process##*/}"]="${id}"
    fi
  done
}

if ! first_tasks="$(task_ids)"; then
  exit 0
fi
readonly first_tasks
find_orphans "${first_tasks}"
((${#candidates[@]} > 0)) || exit 0
sleep 5
if ! second_tasks="$(task_ids)"; then
  exit 0
fi
readonly second_tasks

for pid in "${!candidates[@]}"; do
  if ! current_tasks="$(task_ids)"; then
    continue
  fi
  current_id="$(shim_argument "${pid}" -id 2>/dev/null || true)"
  if is_owned_shim "${pid}" && [[ "${current_id}" = "${candidates[${pid}]}" ]] && \
    ! grep --fixed-strings --line-regexp --quiet "${current_id}" <<<"${second_tasks}" && \
    ! grep --fixed-strings --line-regexp --quiet "${current_id}" <<<"${current_tasks}"; then
    kill --signal TERM "${pid}" 2>/dev/null || true
  fi
done
sleep 2
for pid in "${!candidates[@]}"; do
  if ! current_tasks="$(task_ids)"; then
    continue
  fi
  current_id="$(shim_argument "${pid}" -id 2>/dev/null || true)"
  if is_owned_shim "${pid}" && [[ "${current_id}" = "${candidates[${pid}]}" ]] && \
    ! grep --fixed-strings --line-regexp --quiet "${current_id}" <<<"${current_tasks}"; then
    kill --signal KILL "${pid}" 2>/dev/null || true
  fi
done
EOF
chmod 0755 /usr/local/sbin/compartment-clean-orphan-runsc-shims

cat >/usr/local/sbin/compartment-worker-join <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

readonly server_url="${1:?Usage: compartment-worker-join <server-url> <token-file> <node-ip>}"
readonly token_file="${2:?Usage: compartment-worker-join <server-url> <token-file> <node-ip>}"
readonly node_ip="${3:?Usage: compartment-worker-join <server-url> <token-file> <node-ip>}"

test "$(id -u)" -eq 0
test -r "${token_file}"
[[ "${server_url}" =~ ^https://[A-Za-z0-9.:-]+:6443$ ]]
[[ "${node_ip}" =~ ^[0-9A-Fa-f:.]+$ ]]
test ! -e /etc/default/k3s-agent
systemctl is-active --quiet k3s-agent.service && exit 1

install -d -m 0700 /etc/compartment-worker
install -m 0600 "${token_file}" /etc/compartment-worker/token
cat >/etc/default/k3s-agent <<ENVIRONMENT
K3S_URL=${server_url}
K3S_TOKEN_FILE=/etc/compartment-worker/token
K3S_NODE_IP=${node_ip}
ENVIRONMENT
chmod 0600 /etc/default/k3s-agent
systemctl enable --now k3s-agent.service
EOF
chmod 0755 /usr/local/sbin/compartment-worker-join

cat >/etc/compartment-worker-image <<EOF
architecture=x86_64
k3s_version=${k3s_version}
k3s_sha256=${k3s_sha256}
containerd_version=${containerd_version}
gvisor_version=${gvisor_version}
gvisor_sha256=${gvisor_sha256}
gvisor_sha512=${gvisor_sha512}
EOF

/usr/local/bin/k3s --version | grep --fixed-strings "${k3s_version}"
/usr/local/bin/runsc --version | grep --fixed-strings "${gvisor_version}"
test -x /usr/local/bin/containerd-shim-runsc-v1
test -x /usr/local/sbin/compartment-clean-orphan-runsc-shims
systemctl daemon-reload
systemctl disable k3s-agent.service 2>/dev/null || true
test "$(systemctl is-enabled k3s-agent.service 2>/dev/null || true)" != enabled

apt-get clean
cloud-init clean --logs --machine-id --seed
truncate -s 0 /etc/machine-id
rm -f /var/lib/dbus/machine-id /etc/ssh/ssh_host_*
sync
