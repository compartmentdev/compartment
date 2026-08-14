#!/usr/bin/env bash
set -euo pipefail

readonly rounds="${OOM_ROUNDS:-30}"
readonly batch_size="${OOM_BATCH_SIZE:-10}"
readonly crashloop_restarts="${CRASHLOOP_RESTARTS:-5}"
namespace="compartment-runtime-oom-e2e-$(date +%s)-$$"
readonly namespace
readonly snapshot_path="${RUNTIME_SNAPSHOT_PATH:-worker-runtime-oom-e2e.tsv}"
readonly kubeconfig="${KUBECONFIG:?KUBECONFIG must point to the disposable cluster admin kubeconfig}"
readonly node_name="${NODE_NAME:?NODE_NAME must identify this disposable worker node}"
readonly process_snapshot_path="${snapshot_path%.tsv}.processes.tsv"
readonly metadata_snapshot_path="${snapshot_path%.tsv}.metadata.txt"
expected_containerd_version="$(awk -F= '$1 == "containerd_version" { print $2 }' /etc/compartment-worker-image)"
readonly expected_containerd_version

cleanup() {
  k3s kubectl delete namespace "${namespace}" --ignore-not-found --wait=true >/dev/null 2>&1 || true
}
trap cleanup EXIT

runsc_shim_pids() {
  local process executable shim_namespace
  for process in /proc/[0-9]*; do
    executable="$(readlink "${process}/exe" 2>/dev/null || true)"
    shim_namespace="$(shim_argument "${process##*/}" -namespace 2>/dev/null || true)"
    if [[ "${executable##*/}" = containerd-shim-runsc-v1 ]] && \
      [[ "${shim_namespace}" = k8s.io ]] && \
      grep --fixed-strings --quiet '/system.slice/k3s-agent.service' "${process}/cgroup" 2>/dev/null; then
      basename "${process}"
    fi
  done
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

snapshot() {
  local phase="$1"
  local shims tasks rss psi_some psi_full memory_events
  local -a shim_pids=()
  mapfile -t shim_pids < <(runsc_shim_pids)
  shims="${#shim_pids[@]}"
  tasks="$(k3s ctr --namespace k8s.io tasks list --quiet | wc -l | tr -d ' ')"
  rss="$(ps -eo rss=,cgroup= | awk '$2 ~ /k3s-agent.service/ { kib += $1 } END { print (kib + 0) * 1024 }')"
  psi_some="$(awk '/^some / { print $2 }' /proc/pressure/memory)"
  psi_full="$(awk '/^full / { print $2 }' /proc/pressure/memory)"
  memory_events="$(tr '\n' ',' </sys/fs/cgroup/system.slice/k3s-agent.service/memory.events)"
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
    "${phase}" "${shims}" "${tasks}" "${rss}" "${psi_some}" "${psi_full}" "${memory_events}" \
    | tee -a "${snapshot_path}"
  for shim_pid in "${shim_pids[@]}"; do
    ps --pid "${shim_pid}" --no-headers --format pid=,ppid=,rss=,cgroup=,args= \
      | awk -v phase="${phase}" '{ print phase "\t" $0 }' >>"${process_snapshot_path}"
  done
}

wait_for_oom_batch() {
  local round="$1"
  local deadline=$((SECONDS + 180))
  while ((SECONDS < deadline)); do
    local oom_count
    oom_count="$(k3s kubectl get pods --namespace "${namespace}" --selector "compartment.dev/oom-round=${round}" \
      --output jsonpath='{range .items[*].status.containerStatuses[*]}{.state.terminated.reason}{" "}{.lastState.terminated.reason}{"\n"}{end}' \
      | awk '$1 == "OOMKilled" || $2 == "OOMKilled" { count += 1 } END { print count + 0 }')"
    if [[ "${oom_count}" -eq "${batch_size}" ]]; then
      return
    fi
    sleep 1
  done
  echo "Timed out waiting for OOM round ${round}." >&2
  return 1
}

wait_for_crashloop_restarts() {
  local deadline=$((SECONDS + 600))
  while ((SECONDS < deadline)); do
    local observed
    observed="$(k3s kubectl get pod/crashloop --namespace "${namespace}" \
      --output jsonpath='{.status.containerStatuses[0].restartCount}')"
    if [[ "${observed:-0}" -ge "${crashloop_restarts}" ]]; then
      return
    fi
    sleep 2
  done
  echo 'Timed out waiting for the CrashLoop restart target.' >&2
  return 1
}

wait_for_runtime_cleanup() {
  local expected_shims="$1"
  local expected_tasks="$2"
  local deadline=$((SECONDS + 120))
  while ((SECONDS < deadline)); do
    local shims tasks
    local -a shim_pids=()
    mapfile -t shim_pids < <(runsc_shim_pids)
    shims="${#shim_pids[@]}"
    tasks="$(k3s ctr --namespace k8s.io tasks list --quiet | wc -l | tr -d ' ')"
    if [[ "${shims}" -le "${expected_shims}" && "${tasks}" -le "${expected_tasks}" ]]; then
      return
    fi
    sleep 1
  done
  echo "Runtime cleanup did not return to baseline." >&2
  return 1
}

test "$(id -u)" -eq 0
test "${rounds}" -gt 0
test "${batch_size}" -gt 0
test "${crashloop_restarts}" -gt 0
test -n "${expected_containerd_version}"
test -r "${kubeconfig}"
test -r /etc/compartment-disposable-runtime-test
test "$(cat /etc/compartment-disposable-runtime-test)" = "${node_name}"
systemctl is-active --quiet k3s-agent.service
test "$(systemctl show k3s-agent.service --property KillMode --value)" = process
k3s ctr version | awk -v expected="${expected_containerd_version}" \
  '$1 == "Version:" && $2 == expected { found = 1 } END { exit !found }'
test "$(k3s kubectl get node "${node_name}" \
  --output jsonpath='{.metadata.labels.compartment\.dev/disposable-runtime-test}')" = true
: >"${snapshot_path}"
: >"${process_snapshot_path}"
printf 'phase\trunsc_shims\tcontainerd_tasks\trss_bytes\tpsi_some\tpsi_full\tmemory_events\n' >>"${snapshot_path}"
{
  k3s --version
  /usr/local/bin/runsc --version
  k3s ctr version
  systemctl show k3s-agent.service --property FragmentPath,DropInPaths,KillMode
} >"${metadata_snapshot_path}"

k3s kubectl create namespace "${namespace}"
k3s kubectl apply --filename - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: neighbor
  namespace: ${namespace}
spec:
  automountServiceAccountToken: false
  nodeName: ${node_name}
  restartPolicy: Always
  runtimeClassName: gvisor
  containers:
    - name: neighbor
      image: postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777
      command: [sh, -c]
      args: ["while true; do sleep 60; done"]
      resources:
        requests: {memory: 8Mi}
        limits: {memory: 32Mi}
EOF
k3s kubectl wait pod/neighbor --namespace "${namespace}" --for=condition=Ready --timeout=2m
neighbor_uid="$(k3s kubectl get pod/neighbor --namespace "${namespace}" --output jsonpath='{.metadata.uid}')"
readonly neighbor_uid
neighbor_restart_count="$(k3s kubectl get pod/neighbor --namespace "${namespace}" --output jsonpath='{.status.containerStatuses[0].restartCount}')"
readonly neighbor_restart_count
snapshot baseline
baseline_shims="$(tail -n 1 "${snapshot_path}" | cut -f2)"
readonly baseline_shims
baseline_tasks="$(tail -n 1 "${snapshot_path}" | cut -f3)"
readonly baseline_tasks

k3s kubectl apply --filename - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: crashloop
  namespace: ${namespace}
spec:
  automountServiceAccountToken: false
  nodeName: ${node_name}
  restartPolicy: Always
  runtimeClassName: gvisor
  containers:
    - name: crashloop
      image: postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777
      command: [dd]
      args: [if=/dev/zero, of=/dev/shm/oom, bs=1M, count=128]
      resources:
        requests: {memory: 8Mi}
        limits: {memory: 32Mi}
EOF
wait_for_crashloop_restarts
k3s kubectl delete pod/crashloop --namespace "${namespace}" --wait=true
wait_for_runtime_cleanup "${baseline_shims}" "${baseline_tasks}"
snapshot after-crashloop

for ((round = 1; round <= rounds; round += 1)); do
  for ((index = 1; index <= batch_size; index += 1)); do
    k3s kubectl apply --filename - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: oom-${round}-${index}
  namespace: ${namespace}
  labels:
    compartment.dev/oom-round: "${round}"
spec:
  automountServiceAccountToken: false
  nodeName: ${node_name}
  restartPolicy: Always
  runtimeClassName: gvisor
  containers:
    - name: oom
      image: postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777
      command: [dd]
      args: [if=/dev/zero, of=/dev/shm/oom, bs=1M, count=128]
      resources:
        requests: {memory: 8Mi}
        limits: {memory: 32Mi}
EOF
  done
  wait_for_oom_batch "${round}"
  k3s kubectl delete pods --namespace "${namespace}" --selector "compartment.dev/oom-round=${round}" --wait=true
  wait_for_runtime_cleanup "${baseline_shims}" "${baseline_tasks}"
  snapshot "oom-round-${round}"
done

wait_for_runtime_cleanup "${baseline_shims}" "${baseline_tasks}"
test "$(k3s kubectl get pod/neighbor --namespace "${namespace}" --output jsonpath='{.metadata.uid}')" = "${neighbor_uid}"
test "$(k3s kubectl get pod/neighbor --namespace "${namespace}" --output jsonpath='{.status.containerStatuses[0].restartCount}')" = "${neighbor_restart_count}"
snapshot after-oom

systemctl restart k3s-agent.service
systemctl is-active --quiet k3s-agent.service
k3s kubectl wait node "${node_name}" --for=condition=Ready --timeout=5m
k3s kubectl wait pod/neighbor --namespace "${namespace}" --for=condition=Ready --timeout=2m
test "$(k3s kubectl get pod/neighbor --namespace "${namespace}" --output jsonpath='{.metadata.uid}')" = "${neighbor_uid}"
test "$(k3s kubectl get pod/neighbor --namespace "${namespace}" --output jsonpath='{.status.containerStatuses[0].restartCount}')" = "${neighbor_restart_count}"
wait_for_runtime_cleanup "${baseline_shims}" "${baseline_tasks}"
snapshot after-agent-restart
k3s kubectl delete namespace "${namespace}" --wait=true
wait_for_runtime_cleanup 0 0
snapshot after-delete
