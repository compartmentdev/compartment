#!/usr/bin/env bash
set -euo pipefail

readonly REQUIRED_CPUS=6
readonly REQUIRED_MEMORY_GIB=10
readonly REQUIRED_DISK_GIB=60

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required to install the spike toolchain: https://brew.sh" >&2
  exit 1
fi

missing_formulae=()

require_command() {
  local command_name="$1"
  local formula="$2"

  if ! command -v "${command_name}" >/dev/null 2>&1; then
    missing_formulae+=("${formula}")
  fi
}

require_command docker docker
require_command colima colima
require_command k3d k3d
require_command kind kind
require_command helm helm
require_command kubectl kubernetes-cli
require_command hey hey
require_command node node@24
require_command pnpm pnpm

if ((${#missing_formulae[@]} > 0)); then
  echo "Installing missing tools: ${missing_formulae[*]}"
  brew install "${missing_formulae[@]}"
fi

if ! command -v node >/dev/null 2>&1 && brew list --versions node@24 >/dev/null 2>&1; then
  brew link --overwrite --force node@24
fi

node_major="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
if [[ "${node_major}" != "24" ]]; then
  echo "Node.js 24 is required; found: $(node --version)" >&2
  exit 1
fi

helm_major="$(helm version --template '{{.Version}}' | sed -E 's/^v([0-9]+).*/\1/')"
if [[ "${helm_major}" != "4" ]]; then
  echo "Helm 4 is required; upgrading the Homebrew formula."
  brew upgrade helm || true
  helm_major="$(helm version --template '{{.Version}}' | sed -E 's/^v([0-9]+).*/\1/')"
fi
if [[ "${helm_major}" != "4" ]]; then
  echo "Expected Helm major 4, found: $(helm version --short)" >&2
  exit 1
fi

colima_is_running=false
if colima status >/dev/null 2>&1; then
  colima_is_running=true
fi

colima_resources_sufficient() {
  local cpus memory_kib disk_kib
  cpus="$(colima ssh -- nproc)"
  memory_kib="$(colima ssh -- cat /proc/meminfo | awk '/MemTotal/ { print $2 }')"
  disk_kib="$(colima ssh -- df -Pk /var/lib/docker | awk 'NR == 2 { print $2 }')"

  # The guest reports usable capacity after VM/filesystem overhead.
  ((cpus >= REQUIRED_CPUS)) \
    && ((memory_kib >= REQUIRED_MEMORY_GIB * 1024 * 1024 * 95 / 100)) \
    && ((disk_kib >= REQUIRED_DISK_GIB * 1024 * 1024 * 95 / 100))
}

if [[ "${colima_is_running}" == false ]]; then
  echo "Starting Colima with ${REQUIRED_CPUS} CPU, ${REQUIRED_MEMORY_GIB} GiB memory, and ${REQUIRED_DISK_GIB} GiB disk."
  colima start --cpu "${REQUIRED_CPUS}" --memory "${REQUIRED_MEMORY_GIB}" --disk "${REQUIRED_DISK_GIB}"
elif ! colima_resources_sufficient; then
  echo "Restarting Colima with sufficient resources."
  colima stop
  colima start --cpu "${REQUIRED_CPUS}" --memory "${REQUIRED_MEMORY_GIB}" --disk "${REQUIRED_DISK_GIB}"
fi

docker context use colima >/dev/null
docker_arch="$(docker info --format '{{.Architecture}}')"
case "${docker_arch}" in
  arm64 | aarch64) ;;
  *)
    echo "Colima Docker must be arm64; found ${docker_arch}." >&2
    exit 1
    ;;
esac

echo
echo "Spike toolchain"
docker --version
printf 'docker context: %s (%s)\n' "$(docker context show)" "${docker_arch}"
colima version
k3d version
kind version
helm version --short
kubectl version --client=true --output=yaml | awk '/gitVersion:/ { print "kubectl " $2; exit }'
brew list --versions hey
printf 'node %s\n' "$(node --version)"
printf 'pnpm %s\n' "$(pnpm --version)"

echo
echo "Colima resources"
printf 'cpu: %s\n' "$(colima ssh -- nproc)"
printf 'memory: %s GiB\n' "$(colima ssh -- cat /proc/meminfo | awk '/MemTotal/ { printf "%.1f", $2 / 1024 / 1024 }')"
printf 'docker disk: %s\n' "$(colima ssh -- df -h /var/lib/docker | awk 'NR == 2 { print $2 }')"
