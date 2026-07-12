#!/usr/bin/env bash

SPIKE_ENV_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SPIKE_ENV_DIR
REPO_ROOT="$(cd "${SPIKE_ENV_DIR}/../.." && pwd)"
readonly REPO_ROOT
readonly CHART_DIR="${REPO_ROOT}/deploy/chart/compartment"
export CHART_DIR
readonly SPIKE_USER="${USER:-$(id -un)}"
readonly STATE_DIR="${TMPDIR:-/tmp}/compartment-e2e-${SPIKE_USER}"
readonly LOCK_DIR="${STATE_DIR}/resource.lock"
readonly KIND_CLUSTER_FILE="${STATE_DIR}/kind-cluster-name"
export KIND_CLUSTER_FILE
readonly RESERVATIONS_FILE="${STATE_DIR}/reservations"
readonly COLIMA_REQUIRED_CPUS=6
readonly COLIMA_REQUIRED_MEMORY_GIB=10
readonly COLIMA_REQUIRED_DISK_GIB=60
readonly SOURCE_IMAGE_REFS=(
  ghcr.io/compartmentdev/compartment-api:latest
  ghcr.io/compartmentdev/compartment-worker:latest
  ghcr.io/compartmentdev/compartment-edge:latest
  ghcr.io/compartmentdev/compartment-caddy:latest
)
TRACK_IMAGE_REFS=()

LOCK_HELD=false

docker_socket_path() {
  docker context inspect colima --format '{{.Endpoints.docker.Host}}' | sed 's#^unix://##'
}

docker_api_responds() {
  local socket_path
  socket_path="$(docker_socket_path)"
  curl --fail --silent --max-time 10 --unix-socket "${socket_path}" http://localhost/_ping >/dev/null
}

docker_architecture() {
  local socket_path
  socket_path="$(docker_socket_path)"
  curl --fail --silent --max-time 10 --unix-socket "${socket_path}" http://localhost/info \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).Architecture))'
}

acquire_resource_lock() {
  mkdir -p "${STATE_DIR}"
  if [[ -e "${LOCK_DIR}" && ! -d "${LOCK_DIR}" ]]; then
    rm -f "${LOCK_DIR}"
  fi
  while ! mkdir "${LOCK_DIR}" 2>/dev/null; do
    echo "Waiting for the shared image/port lock..."
    sleep 1
  done
  LOCK_HELD=true
}

release_resource_lock() {
  if [[ "${LOCK_HELD}" == true ]]; then
    rmdir "${LOCK_DIR}"
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

  echo "No free e2e host-port pair is available." >&2
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
    "ghcr.io/compartmentdev/compartment-api:e2e-${track_id}"
    "ghcr.io/compartmentdev/compartment-worker:e2e-${track_id}"
    "ghcr.io/compartmentdev/compartment-edge:e2e-${track_id}"
    "ghcr.io/compartmentdev/compartment-caddy:e2e-${track_id}"
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

wait_for_docker_api() {
  local attempt stable_checks=0
  for attempt in $(seq 1 90); do
    if docker_api_responds; then
      stable_checks=$((stable_checks + 1))
      if ((stable_checks == 3)); then
        return 0
      fi
    else
      stable_checks=0
      if ((attempt == 5)); then
        colima start \
          --cpu "${COLIMA_REQUIRED_CPUS}" \
          --memory "${COLIMA_REQUIRED_MEMORY_GIB}" \
          --disk "${COLIMA_REQUIRED_DISK_GIB}" >/dev/null 2>&1 || true
      elif ((attempt == 15)); then
        colima restart \
          --cpu "${COLIMA_REQUIRED_CPUS}" \
          --memory "${COLIMA_REQUIRED_MEMORY_GIB}" \
          --disk "${COLIMA_REQUIRED_DISK_GIB}" >/dev/null 2>&1 || true
      fi
    fi
    sleep 2
  done
  echo "Docker API did not recover within 180 seconds." >&2
  return 1
}

k3d_cluster_resources_absent() {
  local cluster_name="$1"
  local containers networks volumes
  docker_api_responds || return 1
  containers="$(docker ps --all --quiet --filter "label=k3d.cluster=${cluster_name}")" || return 1
  networks="$(docker network ls --format '{{.Name}}')" || return 1
  volumes="$(docker volume ls --quiet --filter "label=k3d.cluster=${cluster_name}")" || return 1
  [[ -z "${containers}" ]] \
    && ! grep -Fxq "k3d-${cluster_name}" <<<"${networks}" \
    && [[ -z "${volumes}" ]]
}

remove_k3d_cluster_resources() {
  local cluster_name="$1"
  local attempt id stable_checks=0
  local -a container_ids=()
  local -a volume_names=()

  wait_for_docker_api || return 1
  k3d cluster delete "${cluster_name}" >/dev/null 2>&1 || true

  # Colima can report a live Docker API before the daemon has restored all
  # containers after a VM restart. Keep sweeping until absence is stable.
  for attempt in $(seq 1 30); do
    container_ids=()
    volume_names=()
    while IFS= read -r id; do
      [[ -n "${id}" ]] && container_ids+=("${id}")
    done < <(docker ps --all --quiet --filter "label=k3d.cluster=${cluster_name}")
    if ((${#container_ids[@]} > 0)); then
      docker rm --force "${container_ids[@]}" >/dev/null 2>&1 || true
    fi
    if docker network inspect "k3d-${cluster_name}" >/dev/null 2>&1; then
      docker network rm "k3d-${cluster_name}" >/dev/null 2>&1 || true
    fi
    while IFS= read -r id; do
      [[ -n "${id}" ]] && volume_names+=("${id}")
    done < <(docker volume ls --quiet --filter "label=k3d.cluster=${cluster_name}")
    if ((${#volume_names[@]} > 0)); then
      docker volume rm --force "${volume_names[@]}" >/dev/null 2>&1 || true
    fi

    if k3d_cluster_resources_absent "${cluster_name}"; then
      stable_checks=$((stable_checks + 1))
      if ((stable_checks == 5)); then
        if colima ssh -- sync >/dev/null 2>&1; then
          sleep 2
          k3d_cluster_resources_absent "${cluster_name}" && return 0
        fi
        stable_checks=0
      fi
    else
      stable_checks=0
    fi
    sleep 2
  done

  echo "Cluster Docker resources remain for ${cluster_name}." >&2
  return 1
}

kind_cluster_resources_absent() {
  local cluster_name="$1"
  local containers
  docker_api_responds || return 1
  containers="$(docker ps --all --quiet --filter "label=io.x-k8s.kind.cluster=${cluster_name}")" || return 1
  [[ -z "${containers}" ]]
}

remove_kind_cluster_resources() {
  local cluster_name="$1"
  local attempt id stable_checks=0
  local -a container_ids=()

  wait_for_docker_api || return 1
  kind delete cluster --name "${cluster_name}" >/dev/null 2>&1 || true
  for attempt in $(seq 1 30); do
    container_ids=()
    while IFS= read -r id; do
      [[ -n "${id}" ]] && container_ids+=("${id}")
    done < <(docker ps --all --quiet --filter "label=io.x-k8s.kind.cluster=${cluster_name}")
    if ((${#container_ids[@]} > 0)); then
      docker rm --force "${container_ids[@]}" >/dev/null 2>&1 || true
    fi
    if kind_cluster_resources_absent "${cluster_name}"; then
      stable_checks=$((stable_checks + 1))
      if ((stable_checks == 5)); then
        if colima ssh -- sync >/dev/null 2>&1; then
          sleep 2
          kind_cluster_resources_absent "${cluster_name}" && return 0
        fi
        stable_checks=0
      fi
    else
      stable_checks=0
    fi
    sleep 2
  done

  echo "Cluster Docker resources remain for ${cluster_name}." >&2
  return 1
}

wait_for_cluster_api() {
  local context="$1"
  local attempt
  wait_for_docker_api || return 1
  for attempt in $(seq 1 90); do
    if kubectl --context "${context}" --request-timeout=5s get --raw=/readyz >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  echo "Kubernetes API did not recover within 180 seconds for ${context}." >&2
  return 1
}

recover_pending_helm_release() {
  local context="$1"
  local status last_deployed
  status="$(helm status compartment --kube-context "${context}" --namespace compartment --output json 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).info.status ?? "")}catch{}})' || true)"
  case "${status}" in
    pending-*)
      last_deployed="$(helm history compartment --kube-context "${context}" --namespace compartment --output json 2>/dev/null \
        | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const h=JSON.parse(s).filter(x=>x.status==="deployed");process.stdout.write(String(h.at(-1)?.revision ?? ""))}catch{}})' || true)"
      if [[ -n "${last_deployed}" ]]; then
        helm rollback compartment "${last_deployed}" --kube-context "${context}" --namespace compartment --wait --timeout 4m || return 1
      else
        helm uninstall compartment --kube-context "${context}" --namespace compartment --wait --timeout 4m || true
      fi
      ;;
  esac
}

run_staged_helm_install() {
  local context="$1"
  local track_id="$2"
  local http_port="$3"
  local https_port="$4"
  shift 4
  local current_stage
  local -a common_args=(
    --kube-context "${context}"
    --namespace compartment
    --set "ports.http=${http_port}"
    --set "ports.https=${https_port}"
    --set "images.api.tag=e2e-${track_id}"
    --set "images.worker.tag=e2e-${track_id}"
    --set "images.edge.tag=e2e-${track_id}"
    --set "images.caddy.tag=e2e-${track_id}"
    --rollback-on-failure
    --wait
    --timeout 8m
  )

  current_stage="$(helm get values compartment --kube-context "${context}" --namespace compartment --all --output json 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).platform?.startupStage ?? "")}catch{}})' || true)"
  if [[ "${current_stage}" != full ]]; then
    helm upgrade --install compartment "${CHART_DIR}" \
      "${common_args[@]}" "$@" \
      --set platform.startupStage=foundation || return 1
  fi
  kubectl --context "${context}" --namespace compartment wait \
    deployment/compartment-compartment-postgres \
    deployment/compartment-compartment-registry \
    --for=condition=Available --timeout=2m || return 1
  helm upgrade compartment "${CHART_DIR}" \
    "${common_args[@]}" "$@" \
    --set platform.startupStage=full \
    --wait-for-jobs || return 1
  kubectl --context "${context}" --namespace compartment wait deployment --all \
    --for=condition=Available --timeout=2m || return 1
}

install_platform_with_retry() {
  local context="$1"
  local track_id="$2"
  local http_port="$3"
  local https_port="$4"
  shift 4

  if run_staged_helm_install "${context}" "${track_id}" "${http_port}" "${https_port}" "$@"; then
    return 0
  fi

  echo "Initial Helm install failed; checking Kubernetes API before the single retry." >&2
  wait_for_cluster_api "${context}" || return 1
  recover_pending_helm_release "${context}" || return 1
  echo "Retrying Helm install once." >&2
  run_staged_helm_install "${context}" "${track_id}" "${http_port}" "${https_port}" "$@"
}

