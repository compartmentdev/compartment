#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
CONTEXT=k3d-cpt-t3
NAMESPACE=cpt-t3-stateful
FIELD_MANAGER=t3
STATE_DIR="$ROOT/spike/t3/.state"
RESULTS="$ROOT/spike/t3/results.log"

k() { kubectl --context "$CONTEXT" "$@"; }
ssa() { k apply --server-side --field-manager="$FIELD_MANAGER" -f "$@"; }
die() { echo "ERROR: $*" >&2; exit 1; }

require_context() {
  k cluster-info >/dev/null
  [[ "$CONTEXT" == "k3d-cpt-t3" ]] || die "unexpected context: $CONTEXT"
  mkdir -p "$STATE_DIR"
}

log() {
  printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" | tee -a "$RESULTS"
}

now_ms() { python3 -c 'import time; print(time.time_ns() // 1_000_000)'; }

pvc_uid() {
  k -n "$NAMESPACE" get pvc postgres-data -o jsonpath='{.metadata.uid}'
}

db_pod() {
  k -n "$NAMESPACE" get pod -l app=t3-postgres -o jsonpath='{.items[0].metadata.name}'
}

sql() {
  k -n "$NAMESPACE" exec "$(db_pod)" -- env PGPASSWORD=t3-password \
    psql -U t3 -d t3 -Atqc "$1"
}

wait_db() {
  k -n "$NAMESPACE" rollout status deployment/t3-postgres --timeout=180s
  k -n "$NAMESPACE" wait --for=condition=Ready pod -l app=t3-postgres --timeout=180s
}

verify_ledger() {
  local result
  result=$(sql "WITH s AS (SELECT count(*) n, coalesce(min(seq),0) lo, coalesce(max(seq),0) hi, count(*) FILTER (WHERE checksum <> md5(seq::text || ':t3')) bad FROM ledger) SELECT n||'|'||lo||'|'||hi||'|'||bad||'|'||(CASE WHEN n=0 OR n=hi-lo+1 THEN 0 ELSE hi-lo+1-n END) FROM s;")
  IFS='|' read -r rows lo hi bad gaps <<<"$result"
  [[ "$bad" == 0 && "$gaps" == 0 ]] || die "ledger corruption rows=$rows range=$lo..$hi bad=$bad gaps=$gaps"
  log "ledger rows=$rows range=$lo..$hi checksum_failures=$bad gaps=$gaps"
}

stop_all() {
  k -n "$NAMESPACE" scale deployment/t3-writer --replicas=0
  k -n "$NAMESPACE" wait --for=delete pod -l app=t3-writer --timeout=120s
  k -n "$NAMESPACE" scale deployment/t3-postgres --replicas=0
  k -n "$NAMESPACE" wait --for=delete pod -l app=t3-postgres --timeout=120s
  [[ -z "$(k -n "$NAMESPACE" get pod -l 'app in (t3-writer,t3-postgres)' -o name)" ]] || die "stateful pods still exist"
}

start_all() {
  k -n "$NAMESPACE" scale deployment/t3-postgres --replicas=1
  wait_db
  k -n "$NAMESPACE" scale deployment/t3-writer --replicas=1
  k -n "$NAMESPACE" rollout status deployment/t3-writer --timeout=120s
}
