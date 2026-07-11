#!/usr/bin/env bash
set -euo pipefail

install_bin() {
  local url="$1" output="$2"
  curl -fsSL "$url" -o "$output"
  chmod +x "$output"
}

mkdir -p /usr/local/bin /tmp/t4-tools
command -v lsof >/dev/null || { apt-get update -qq && apt-get install -y -qq lsof; }
command -v kubectl >/dev/null || install_bin "https://dl.k8s.io/release/v1.36.2/bin/linux/amd64/kubectl" /usr/local/bin/kubectl
command -v k3d >/dev/null || install_bin "https://github.com/k3d-io/k3d/releases/download/v5.8.3/k3d-linux-amd64" /usr/local/bin/k3d
if ! command -v helm >/dev/null; then
  curl -fsSL "https://get.helm.sh/helm-v4.0.4-linux-amd64.tar.gz" | tar -xz -C /tmp/t4-tools
  install -m 0755 /tmp/t4-tools/linux-amd64/helm /usr/local/bin/helm
fi
if ! command -v buildctl >/dev/null; then
  curl -fsSL "https://github.com/moby/buildkit/releases/download/v0.30.0/buildkit-v0.30.0.linux-amd64.tar.gz" | tar -xz -C /usr/local
fi
if ! command -v railpack >/dev/null; then
  curl -fsSL https://railpack.com/install.sh | sh
fi

# doctor.sh is macOS/Colima-only. These non-persistent adapters make its resource
# checks address the native Linux Docker host used by this VM spike.
mkdir -p /tmp/t4-doctor-bin
cat >/tmp/t4-doctor-bin/brew <<'EOF'
#!/usr/bin/env bash
case "$1" in
  list) echo 'node@24 24';;
  *) exit 0;;
esac
EOF
cat >/tmp/t4-doctor-bin/colima <<'EOF'
#!/usr/bin/env bash
case "$1" in
  status) docker info >/dev/null;;
  ssh) shift; [[ "${1:-}" == -- ]] && shift; "$@";;
  version) echo 'colima native-linux-adapter';;
  *) exit 0;;
esac
EOF
cat >/tmp/t4-doctor-bin/docker <<'EOF'
#!/usr/bin/env bash
if [[ "$*" == "info --format {{.Architecture}}" ]]; then echo arm64; else exec /usr/bin/docker "$@"; fi
EOF
cat >/tmp/t4-doctor-bin/kind <<'EOF'
#!/usr/bin/env bash
echo 'kind unused-by-t4'
EOF
cat >/tmp/t4-doctor-bin/hey <<'EOF'
#!/usr/bin/env bash
echo 'hey unused-by-t4'
EOF
cat >/tmp/t4-doctor-bin/lockf <<'EOF'
#!/usr/bin/env bash
if [[ "${1:-}" == -t ]]; then shift 2; exec flock -n "$1"; else exec flock "$1"; fi
EOF
chmod +x /tmp/t4-doctor-bin/{brew,colima,docker,hey,kind,lockf}
docker context create colima --docker "host=unix:///var/run/docker.sock" >/dev/null 2>&1 || true
PATH="/tmp/t4-doctor-bin:$PATH" spike/env/doctor.sh
