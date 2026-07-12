#!/usr/bin/env bash
set -euo pipefail

readonly TRACK_ID="${1:-}"
if [[ -z "${TRACK_ID}" ]]; then
  echo "Usage: $0 <track-id>" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/e2e/common.sh
source "${SCRIPT_DIR}/common.sh"

validate_track_id "${TRACK_ID}"

if ! docker context inspect colima >/dev/null 2>&1; then
  echo "Docker context 'colima' is unavailable; run deploy/e2e/doctor.sh first." >&2
  exit 1
fi
docker context use colima >/dev/null

acquire_resource_lock
trap release_resource_lock EXIT INT TERM
wait_for_docker_api
CLUSTER_NAME="cpt-${TRACK_ID}"
if [[ "${TRACK_ID}" == kind && -s "${KIND_CLUSTER_FILE}" ]]; then
  CLUSTER_NAME="$(cat "${KIND_CLUSTER_FILE}")"
fi
readonly CLUSTER_NAME
read -r RUNTIME _ < <(read_reservation "${TRACK_ID}") || true

if [[ -z "${RUNTIME:-}" ]]; then
  if k3d cluster list --no-headers | awk '{print $1}' | grep -Fxq "${CLUSTER_NAME}"; then
    RUNTIME=k3d
  else
    echo "No reservation or cluster found for ${TRACK_ID}." >&2
    exit 1
  fi
fi

case "${RUNTIME}" in
  k3d)
    remove_k3d_cluster_resources "${CLUSTER_NAME}"
    ;;
  *)
    echo "Unknown recorded runtime: ${RUNTIME}" >&2
    exit 1
    ;;
esac

release_reservation "${TRACK_ID}"
echo "Removed ${CLUSTER_NAME}; other e2e clusters were not touched."
