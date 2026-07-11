#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
readonly context=k3d-cpt-t9 namespace=t9 selector=compartment.track=t9

reset_case() {
  pkill -f 'tsx src/main.ts run' 2>/dev/null || true
  kubectl --context "$context" delete namespace "$namespace" --ignore-not-found --wait=true >/dev/null
  rm -rf state && mkdir -p state
}

wait_marker() {
  for _ in {1..100}; do [[ -s state/killpoint ]] && return; sleep .1; done
  echo "killpoint not reached" >&2; exit 1
}

kill_marked() {
  wait_marker
  kill -9 "$(awk 'END {print $2}' state/killpoint)"
}

start_controller() {
  T9_KILLPOINT="${1:-}" ./node_modules/.bin/tsx src/main.ts run >state/controller.log 2>&1 &
  echo $!
}

wait_active() {
  local id="$1"
  for _ in {1..300}; do
    node -e 'const d=require("./state/db.json");process.exit(d.rows.find(r=>r.id===process.argv[1])?.status==="active"?0:1)' "$id" 2>/dev/null && return
    sleep .1
  done
  cat state/controller.log >&2; exit 1
}

assert_unique() {
  local id="$1" kind count
  for kind in deployment service; do
    count="$(kubectl --context "$context" -n "$namespace" get "$kind" -l "$selector,compartment.id=$id" -o name | wc -l | tr -d ' ')"
    [[ "$count" == 1 ]] || { echo "$kind/$id count=$count" >&2; exit 1; }
  done
}

recover() {
  local id="$1" pid
  pid="$(start_controller)"
  wait_active "$id"
  assert_unique "$id"
  kill "$pid" 2>/dev/null || true
}

kill_matrix() {
  local point id pid
  for point in after-desired-before-apply after-apply-before-pending after-apply-before-ready during-informer-event; do
    reset_case; id="kill-${point}"
    if [[ "$point" == after-desired-before-apply ]]; then
      T9_KILLPOINT="$point" ./node_modules/.bin/tsx src/main.ts seed "$id" &
      kill_marked
    else
      ./node_modules/.bin/tsx src/main.ts seed "$id"
      pid="$(start_controller "$point")"
      kill_marked; wait "$pid" 2>/dev/null || true
    fi
    rm -f state/killpoint
    recover "$id"
    echo "PASS kill $point"
  done
}

field_and_delete() {
  reset_case; ./node_modules/.bin/tsx src/main.ts seed ownership
  local pid; pid="$(start_controller)"; wait_active ownership
  kubectl --context "$context" -n "$namespace" patch deploy t9-ownership --type=merge -p '{"spec":{"replicas":2,"template":{"spec":{"containers":[{"name":"app","image":"nginx:alpine","env":[{"name":"T9","value":"edited"}]}]}}}}' >/dev/null
  for _ in {1..100}; do
    [[ "$(kubectl --context "$context" -n "$namespace" get deploy t9-ownership -o jsonpath='{.spec.replicas}')" == 1 ]] && break
    sleep .1
  done
  [[ "$(kubectl --context "$context" -n "$namespace" get deploy t9-ownership -o jsonpath='{.spec.template.spec.containers[0].image}')" == nginx:1.27-alpine ]]
  [[ "$(kubectl --context "$context" -n "$namespace" get deploy t9-ownership -o jsonpath='{.spec.template.spec.containers[0].env[0].value}')" == ownership ]]
  kubectl --context "$context" -n "$namespace" apply --server-side --force-conflicts --field-manager=human -f - >/dev/null <<'YAML'
apiVersion: apps/v1
kind: Deployment
metadata: {name: t9-ownership, namespace: t9}
spec:
  replicas: 3
YAML
  for _ in {1..100}; do grep -q '"kind":"conflict"' state/audit.jsonl 2>/dev/null && break; sleep .1; done
  grep -q '"kind":"conflict"' state/audit.jsonl
  for _ in {1..100}; do [[ "$(kubectl --context "$context" -n "$namespace" get deploy t9-ownership -o jsonpath='{.spec.replicas}')" == 1 ]] && break; sleep .1; done
  wait_active ownership
  kubectl --context "$context" -n "$namespace" delete deploy t9-ownership >/dev/null
  for _ in {1..200}; do kubectl --context "$context" -n "$namespace" get deploy t9-ownership >/dev/null 2>&1 && break; sleep .1; done
  assert_unique ownership
  grep -q '"kind":"deleted"' state/audit.jsonl
  kubectl --context "$context" create deploy foreign --image=nginx -n "$namespace" >/dev/null
  kubectl --context "$context" -n "$namespace" scale deploy foreign --replicas=3 >/dev/null; sleep 2
  [[ "$(kubectl --context "$context" -n "$namespace" get deploy foreign -o jsonpath='{.spec.replicas}')" == 3 ]]
  kill "$pid" 2>/dev/null || true
  echo "PASS ownership delete foreign-negative"
}

job_recovery() {
  reset_case; ./node_modules/.bin/tsx src/main.ts seed job-once
  local pid; pid="$(start_controller)"; wait_active job-once
  for _ in {1..100}; do kubectl --context "$context" -n "$namespace" get job t9-job-once-job >/dev/null 2>&1 && break; sleep .1; done
  [[ -z "$(kubectl --context "$context" -n "$namespace" get job t9-job-once-job -o jsonpath='{.status.succeeded}')" ]]
  kill -9 "$pid" 2>/dev/null || true
  pid="$(start_controller)"
  for _ in {1..300}; do
    node -e 'const d=require("./state/db.json");process.exit(d.rows[0]?.jobResult==="t9-job-result"?0:1)' 2>/dev/null && break
    sleep .1
  done
  node -e 'const d=require("./state/db.json");process.exit(d.rows[0]?.jobResult==="t9-job-result"?0:1)'
  [[ "$(kubectl --context "$context" -n "$namespace" get job -l "$selector,compartment.id=job-once" -o name | wc -l | tr -d ' ')" == 1 ]]
  kill "$pid" 2>/dev/null || true
  echo "PASS deterministic job"
}

scale() {
  reset_case
  for n in {1..50}; do ./node_modules/.bin/tsx src/main.ts seed "scale-$n"; done
  local started pid elapsed db_ids cache_ids list_ids; started="$(date +%s)"; pid="$(start_controller)"
  for _ in {1..600}; do
    [[ "$(kubectl --context "$context" -n "$namespace" get deploy -l "$selector" -o name 2>/dev/null | wc -l | tr -d ' ')" == 50 ]] && break
    sleep .2
  done
  for _ in {1..600}; do
    [[ "$(node -e 'const d=require("./state/db.json");console.log(d.rows.filter(r=>r.status==="active").length)')" == 50 ]] && break
    sleep .2
  done
  elapsed=$(( $(date +%s) - started ))
  db_ids="$(node -e 'const d=require("./state/db.json");console.log(d.rows.map(r=>r.id).sort().join("\n"))')"
  cache_ids="$(node -e 'const d=require("./state/cache.json");console.log(d.deployments.sort().join("\n"))')"
  list_ids="$(kubectl --context "$context" -n "$namespace" get deploy -l "$selector" -o json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).items.map(x=>x.metadata.labels["compartment.id"]).sort().join("\n")))')"
  [[ "$db_ids" == "$cache_ids" && "$db_ids" == "$list_ids" ]]
  [[ "$(node -e 'const d=require("./state/cache.json");console.log(d.services.length)')" == 50 ]]
  [[ "$(kubectl --context "$context" -n "$namespace" get service -l "$selector" -o name | wc -l | tr -d ' ')" == 50 ]]
  kill "$pid" 2>/dev/null || true
  echo "PASS scale=50 elapsed=${elapsed}s"
}

disconnect() {
  reset_case; ./node_modules/.bin/tsx src/main.ts seed reconnect
  local pid; pid="$(start_controller)"; wait_active reconnect
  docker stop k3d-cpt-t9-serverlb >/dev/null
  docker exec k3d-cpt-t9-server-0 kubectl -n "$namespace" patch deploy t9-reconnect --type=merge -p '{"spec":{"replicas":2}}' >/dev/null
  sleep 3; docker start k3d-cpt-t9-serverlb >/dev/null
  for _ in {1..100}; do
    grep -q '"kind":"conflict"' state/audit.jsonl 2>/dev/null && [[ "$(kubectl --context "$context" -n "$namespace" get deploy t9-reconnect -o jsonpath='{.spec.replicas}' 2>/dev/null)" == 1 ]] && break
    sleep .2
  done
  grep -q '"kind":"conflict"' state/audit.jsonl
  wait_active reconnect
  [[ "$(kubectl --context "$context" -n "$namespace" get deploy t9-reconnect -o jsonpath='{.spec.replicas}')" == 1 ]]
  kill "$pid" 2>/dev/null || true
  echo "PASS informer reconnect"
}

case "${1:-all}" in
  kill) kill_matrix ;;
  field) field_and_delete ;;
  job) job_recovery ;;
  scale) scale ;;
  disconnect) disconnect ;;
  all) kill_matrix; field_and_delete; job_recovery; disconnect; scale ;;
esac
