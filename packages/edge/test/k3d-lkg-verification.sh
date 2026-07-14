#!/usr/bin/env bash
set -euo pipefail

: "${COMPARTMENT_P10_API_DEPLOYMENT:?set namespace/deployment for API}"
: "${COMPARTMENT_P10_EDGE_DEPLOYMENT:?set namespace/deployment for edge}"
: "${COMPARTMENT_P10_UPSTREAM_PROBE_COMMAND:?set an executable that succeeds only for expected upstream content}"
: "${COMPARTMENT_P10_RELOGIN_PROBE_COMMAND:?set an executable that verifies one login redirect without a loop}"
: "${COMPARTMENT_P10_POST_RESTORE_COMMAND:?set an executable that restores the sampled session}"
: "${COMPARTMENT_P10_AUTHORIZED_PROBE_COMMAND:?set an executable that succeeds only while the sampled grant works}"
: "${COMPARTMENT_P10_REVOKE_COMMAND:?set the executable that revokes the sampled grant}"
: "${COMPARTMENT_P10_GRANT_COMMAND:?set the executable that restores the sampled grant}"
: "${COMPARTMENT_P10_KUBE_CONTEXT:=k3d-compartment-e2e}"
: "${COMPARTMENT_P10_SNAPSHOT_PATH:=/var/lib/compartment/snapshots/access-state.json}"
: "${COMPARTMENT_P10_SNAPSHOT_HOST:?set the route host that must be present in the snapshot}"
: "${COMPARTMENT_P10_REVOCATION_SAMPLES:=100}"

api_namespace="${COMPARTMENT_P10_API_DEPLOYMENT%%/*}"
api_name="${COMPARTMENT_P10_API_DEPLOYMENT#*/}"
edge_namespace="${COMPARTMENT_P10_EDGE_DEPLOYMENT%%/*}"
edge_name="${COMPARTMENT_P10_EDGE_DEPLOYMENT#*/}"
kubectl_args=(--context "$COMPARTMENT_P10_KUBE_CONTEXT")
api_replicas="$(kubectl "${kubectl_args[@]}" -n "$api_namespace" get deployment "$api_name" -o jsonpath='{.spec.replicas}')"
samples_file="$(mktemp)"

cleanup() {
  kubectl "${kubectl_args[@]}" -n "$api_namespace" scale deployment "$api_name" --replicas="$api_replicas" >/dev/null
  rm -f "$samples_file"
}
trap cleanup EXIT

"$COMPARTMENT_P10_UPSTREAM_PROBE_COMMAND"
edge_pod="$(kubectl "${kubectl_args[@]}" -n "$edge_namespace" get pod -l app.kubernetes.io/component=edge -o jsonpath='{.items[0].metadata.name}')"
kubectl "${kubectl_args[@]}" -n "$edge_namespace" exec "$edge_pod" -- test -s "$COMPARTMENT_P10_SNAPSHOT_PATH"
snapshot_deadline="$(( $(node -p 'Date.now()') + 30000 ))"
until kubectl "${kubectl_args[@]}" -n "$edge_namespace" exec "$edge_pod" -- \
  grep --fixed-strings --quiet "\"host\":\"$COMPARTMENT_P10_SNAPSHOT_HOST\"" "$COMPARTMENT_P10_SNAPSHOT_PATH"; do
  if (( $(node -p 'Date.now()') >= snapshot_deadline )); then
    echo 'current route did not converge into the edge snapshot within 30s' >&2
    exit 1
  fi
  sleep 0.2
done
kubectl "${kubectl_args[@]}" -n "$api_namespace" scale deployment "$api_name" --replicas=0
kubectl "${kubectl_args[@]}" -n "$edge_namespace" rollout restart deployment "$edge_name"
kubectl "${kubectl_args[@]}" -n "$edge_namespace" rollout status deployment "$edge_name" --timeout=120s
"$COMPARTMENT_P10_RELOGIN_PROBE_COMMAND"

kubectl "${kubectl_args[@]}" -n "$api_namespace" scale deployment "$api_name" --replicas="$api_replicas"
kubectl "${kubectl_args[@]}" -n "$api_namespace" rollout status deployment "$api_name" --timeout=120s
"$COMPARTMENT_P10_POST_RESTORE_COMMAND"

for ((sample = 0; sample < COMPARTMENT_P10_REVOCATION_SAMPLES; sample += 1)); do
  "$COMPARTMENT_P10_GRANT_COMMAND"
  grant_deadline="$(( $(node -p 'Date.now()') + 30000 ))"
  until "$COMPARTMENT_P10_AUTHORIZED_PROBE_COMMAND"; do
    if (( $(node -p 'Date.now()') >= grant_deadline )); then
      echo 'grant did not converge within 30s' >&2
      exit 1
    fi
    sleep 0.1
  done
  started_at="$(node -p 'Date.now()')"
  "$COMPARTMENT_P10_REVOKE_COMMAND"
  deadline="$((started_at + 30000))"
  while "$COMPARTMENT_P10_AUTHORIZED_PROBE_COMMAND"; do
    if (( $(node -p 'Date.now()') >= deadline )); then
      echo 'revocation did not converge within 30s' >&2
      exit 1
    fi
    sleep 0.05
  done
  echo "$(( $(node -p 'Date.now()') - started_at ))" >>"$samples_file"
done

sort -n "$samples_file" | awk -v count="$COMPARTMENT_P10_REVOCATION_SAMPLES" '
  { values[NR] = $1 }
  END {
    p95 = int((count * 95 + 99) / 100)
    p99 = int((count * 99 + 99) / 100)
    printf "revocation_ms p95=%d p99=%d samples=%d\n", values[p95], values[p99], count
  }
'
