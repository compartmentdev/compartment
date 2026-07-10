#!/usr/bin/env bash

SPIKE_ENV_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SPIKE_ENV_DIR
REPO_ROOT="$(cd "${SPIKE_ENV_DIR}/../.." && pwd)"
readonly REPO_ROOT
readonly CHART_DIR="${REPO_ROOT}/spike/chart/compartment"
export CHART_DIR
readonly STATE_DIR="${TMPDIR:-/tmp}/compartment-spike-${USER}"
readonly LOCK_FILE="${STATE_DIR}/resource.lock"
readonly RESERVATIONS_FILE="${STATE_DIR}/reservations"
readonly SOURCE_IMAGE_REFS=(
  ghcr.io/compartmentdev/compartment-api:latest
  ghcr.io/compartmentdev/compartment-worker:latest
  ghcr.io/compartmentdev/compartment-edge:latest
  ghcr.io/compartmentdev/compartment-caddy:latest
)
TRACK_IMAGE_REFS=()

LOCK_HELD=false

acquire_resource_lock() {
  local owner_pid
  mkdir -p "${STATE_DIR}"
  while ! (set -o noclobber; printf '%s\n' "$$" >"${LOCK_FILE}") 2>/dev/null; do
    owner_pid="$(head -1 "${LOCK_FILE}" 2>/dev/null || true)"
    if [[ ! "${owner_pid}" =~ ^[0-9]+$ ]] \
      || ! kill -0 "${owner_pid}" 2>/dev/null \
      || ! ps -p "${owner_pid}" -o command= | grep -Eq 'spike/env/(up|up-kind|down)\.sh'; then
      echo "Reclaiming stale shared image/port lock."
      rm -f "${LOCK_FILE}"
      continue
    fi
    echo "Waiting for the shared image/port lock..."
    sleep 1
  done
  LOCK_HELD=true
}

release_resource_lock() {
  if [[ "${LOCK_HELD}" == true ]]; then
    rm -f "${LOCK_FILE}"
    LOCK_HELD=false
  fi
}

validate_track_id() {
  local track_id="$1"
  if [[ ! "${track_id}" =~ ^[a-z0-9][a-z0-9-]{0,31}$ ]]; then
    echo "track-id must match ^[a-z0-9][a-z0-9-]{0,31}$" >&2
    exit 2
  fi
}

port_is_available() {
  local port="$1"
  ! lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1 \
    && ! awk -F '|' -v port="${port}" '$3 == port || $4 == port { found = 1 } END { exit found ? 0 : 1 }' "${RESERVATIONS_FILE}" 2>/dev/null
}

reserve_ports() {
  local track_id="$1"
  local runtime="$2"
  local offset http_port https_port

  touch "${RESERVATIONS_FILE}"
  if awk -F '|' -v track="${track_id}" '$1 == track { found = 1 } END { exit found ? 0 : 1 }' "${RESERVATIONS_FILE}"; then
    echo "Track ${track_id} already has a reservation; run down.sh ${track_id} first." >&2
    return 1
  fi

  for offset in $(seq 0 99); do
    http_port=$((18080 + offset))
    https_port=$((18443 + offset))
    if port_is_available "${http_port}" && port_is_available "${https_port}"; then
      printf '%s|%s|%s|%s\n' "${track_id}" "${runtime}" "${http_port}" "${https_port}" >>"${RESERVATIONS_FILE}"
      printf '%s %s\n' "${http_port}" "${https_port}"
      return 0
    fi
  done

  echo "No free spike host-port pair is available." >&2
  return 1
}

read_reservation() {
  local track_id="$1"
  awk -F '|' -v track="${track_id}" '$1 == track { print $2, $3, $4; exit }' "${RESERVATIONS_FILE}" 2>/dev/null
}

release_reservation() {
  local track_id="$1"
  local temporary_file
  temporary_file="${RESERVATIONS_FILE}.tmp.$$"
  awk -F '|' -v track="${track_id}" '$1 != track' "${RESERVATIONS_FILE}" 2>/dev/null >"${temporary_file}" || true
  mv "${temporary_file}" "${RESERVATIONS_FILE}"
}

set_track_image_refs() {
  local track_id="$1"
  TRACK_IMAGE_REFS=(
    "ghcr.io/compartmentdev/compartment-api:spike-${track_id}"
    "ghcr.io/compartmentdev/compartment-worker:spike-${track_id}"
    "ghcr.io/compartmentdev/compartment-edge:spike-${track_id}"
    "ghcr.io/compartmentdev/compartment-caddy:spike-${track_id}"
  )
}

prepare_track_images() {
  local track_id="$1"
  local index env_file_created=false
  set_track_image_refs "${track_id}"

  if [[ ! -f "${REPO_ROOT}/.env.self-hosted" ]]; then
    cp "${REPO_ROOT}/.env.self-hosted.example" "${REPO_ROOT}/.env.self-hosted"
    env_file_created=true
  fi
  if ! (
    cd "${REPO_ROOT}"
    COMPARTMENT_API_IMAGE="${SOURCE_IMAGE_REFS[0]}" \
      COMPARTMENT_WORKER_IMAGE="${SOURCE_IMAGE_REFS[1]}" \
      COMPARTMENT_EDGE_IMAGE="${SOURCE_IMAGE_REFS[2]}" \
      COMPARTMENT_CADDY_IMAGE="${SOURCE_IMAGE_REFS[3]}" \
      COMPARTMENT_RUNTIME_PROBE_IMAGE=ghcr.io/compartmentdev/compartment-runtime-probe:latest \
      pnpm self-hosted:build
  ); then
    if [[ "${env_file_created}" == true ]]; then
      rm "${REPO_ROOT}/.env.self-hosted"
    fi
    return 1
  fi
  if [[ "${env_file_created}" == true ]]; then
    rm "${REPO_ROOT}/.env.self-hosted"
  fi

  for index in "${!SOURCE_IMAGE_REFS[@]}"; do
    docker image tag "${SOURCE_IMAGE_REFS[$index]}" "${TRACK_IMAGE_REFS[$index]}"
  done
}

import_k3d_images() {
  local cluster_name="$1"
  local track_id="$2"
  set_track_image_refs "${track_id}"
  k3d image import --cluster "${cluster_name}" "${TRACK_IMAGE_REFS[@]}"
}

import_kind_images() {
  local cluster_name="$1"
  local track_id="$2"
  set_track_image_refs "${track_id}"
  kind load docker-image --name "${cluster_name}" "${TRACK_IMAGE_REFS[@]}"
}
