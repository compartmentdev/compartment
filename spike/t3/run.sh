#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/common.sh"
require_context

phase=${1:-pre-teardown}

case "$phase" in
pre-teardown)
  rm -f "$RESULTS"
  "$ROOT/spike/t3/bootstrap.sh"
  sleep 5
  verify_ledger

  # Negative first: RWO permits two same-node mounts.
  node=$(k -n "$NAMESPACE" get pod -l app=t3-postgres -o jsonpath='{.items[0].spec.nodeName}')
  for name in rwo-a rwo-b; do
    sed "s/NAME/$name/g; s/NODE/$node/g; s/ACCESS_MODE/ReadWriteOnce/g" "$ROOT/spike/t3/mount-probe.yaml.tpl" | ssa -
  done
  k -n "$NAMESPACE" wait --for=condition=Ready pod/rwo-a pod/rwo-b --timeout=90s
  sleep 2
  shared=$(k -n "$NAMESPACE" exec rwo-a -- sh -c "grep -c '^rwo-[ab]:' /data/concurrent-writers")
  [[ "$shared" -gt 2 ]] || die "concurrent writes not observed"
  log "rwo_negative node=$node both_pods_ready=yes shared_writes=$shared verdict=node_scoped_and_unsafe"
  k -n "$NAMESPACE" delete pod rwo-a rwo-b --wait=true

  # RWOP capability is proved by behavior, not API acceptance.
  provisioner=$(k get storageclass local-path -o jsonpath='{.provisioner}')
  log "storage_class=local-path provisioner=$provisioner csi=$(k get csidriver -o name | paste -sd, - || true)"
  if sed 's/name: postgres-data/name: rwop-data/; s/ReadWriteOnce/ReadWriteOncePod/' "$ROOT/spike/t3/pvc-only.yaml" | ssa - 2>>"$RESULTS"; then
    for name in rwop-a rwop-b; do
      sed "s/NAME/$name/g; s/NODE/$node/g; s/postgres-data/rwop-data/g" "$ROOT/spike/t3/mount-probe.yaml.tpl" | ssa -
    done
    sleep 20
    ready=$(k -n "$NAMESPACE" get pod rwop-a rwop-b -o jsonpath='{range .items[*]}{.metadata.name}:{.status.phase}:{range .status.conditions[?(@.type=="Ready")]}{.status}{end}{" "}{end}')
    ready_count=$({ grep -o 'Running:True' <<<"$ready" || true; } | wc -l | tr -d ' ')
    if [[ "$ready_count" == 1 ]]; then
      log "rwop_verdict=yes second_consumer_refused=yes state=$ready provisioner=$provisioner"
    elif [[ "$ready_count" == 0 ]]; then
      log "rwop_verdict=no reason=non_csi_claim_unbound state=$ready provisioner=$provisioner"
    else
      log "rwop_verdict=unsafe both_consumers_ready=yes state=$ready provisioner=$provisioner"
      die "RWOP did not fence the second consumer"
    fi
    k -n "$NAMESPACE" delete pod rwop-a rwop-b --wait=true
  else
    log "rwop_verdict=no reason=claim_rejected provisioner=$provisioner"
  fi
  k -n "$NAMESPACE" delete pvc rwop-data --ignore-not-found

  # Managed v1 -> v2, with complete pod absence between versions.
  high_water=$(sql 'select coalesce(max(seq),0) from ledger')
  before=$(now_ms); stop_all; stopped=$(now_ms)
  sed 's/postgres:16.9-alpine/postgres:16.10-alpine/g' "$ROOT/spike/t3/fixture.yaml" >"$STATE_DIR/v2.yaml"
  expected=$(<"$STATE_DIR/postgres-data.uid"); [[ "$(pvc_uid)" == "$expected" ]] || die "PVC identity changed"
  ssa "$STATE_DIR/v2.yaml"
  start_all; started=$(now_ms)
  sleep 5; verify_ledger
  [[ "$(sql 'select coalesce(max(seq),0) from ledger')" -ge "$high_water" ]] || die "committed tail lost across update"
  log "managed_update stop_ms=$((stopped-before)) stop_to_ready_ms=$((started-before)) committed_high_water=$high_water image=v2"

  # Managed image rollback retains the same data/PVC; it does not revert format.
  high_water=$(sql 'select coalesce(max(seq),0) from ledger')
  before=$(now_ms); stop_all
  "$ROOT/spike/t3/guarded-apply.sh"
  start_all; started=$(now_ms)
  sleep 3; verify_ledger
  [[ "$(sql 'select coalesce(max(seq),0) from ledger')" -ge "$high_water" ]] || die "committed tail lost across rollback"
  log "image_rollback cycle_ms=$((started-before)) committed_high_water=$high_water pvc_uid=$(pvc_uid) data_format_rollback=no"

  # Kill writer while an uncommitted insert is sleeping, then stop DB.
  high_water=$(sql 'select coalesce(max(seq),0) from ledger')
  writer_pod=$(k -n "$NAMESPACE" get pod -l app=t3-writer -o jsonpath='{.items[0].metadata.name}')
  k -n "$NAMESPACE" scale deployment/t3-writer --replicas=0
  k -n "$NAMESPACE" delete pod "$writer_pod" --grace-period=0 --force
  k -n "$NAMESPACE" run inflight --image=postgres:16.9-alpine --restart=Never --env=PGPASSWORD=t3-password -- \
    sh -ec "psql -h t3-postgres -U t3 -d t3 -v ON_ERROR_STOP=1 -c \"begin; insert into ledger values (999999999, md5('999999999:t3')); select pg_sleep(60); commit;\""
  sleep 3
  k -n "$NAMESPACE" delete pod inflight --grace-period=0 --force
  stop_all
  start_all
  [[ "$(sql 'select coalesce(max(seq),0) from ledger')" -ge "$high_water" ]] || die "acknowledged writer tail lost"
  [[ "$(sql 'select count(*) from ledger where seq=999999999')" == 0 ]] || die "uncommitted row survived"
  verify_ledger
  log "inflight_kill committed_high_water=$high_water uncommitted_row=absent database_consistent=yes"

  # Backup with a Job to a separate PVC, then copy it outside the cluster.
  k -n "$NAMESPACE" scale deployment/t3-writer --replicas=0
  k -n "$NAMESPACE" wait --for=delete pod -l app=t3-writer --timeout=90s
  verify_ledger
  sql 'select count(*), coalesce(max(seq),0) from ledger' >"$STATE_DIR/backup.meta"
  ssa "$ROOT/spike/t3/backup.yaml"
  k -n "$NAMESPACE" wait --for=condition=Ready pod -l job-name=t3-backup --timeout=180s
  backup_pod=$(k -n "$NAMESPACE" get pod -l job-name=t3-backup -o jsonpath='{.items[0].metadata.name}')
  for _ in $(seq 1 180); do
    k -n "$NAMESPACE" exec "$backup_pod" -- test -f /backup/t3.ready && break
    sleep 1
  done
  k -n "$NAMESPACE" exec "$backup_pod" -- test -f /backup/t3.ready || die "backup did not complete"
  k -n "$NAMESPACE" cp "$backup_pod:/backup/t3.dump" "$STATE_DIR/t3.dump"
  log "backup local_file=$STATE_DIR/t3.dump meta=$(cat "$STATE_DIR/backup.meta")"
  k -n "$NAMESPACE" delete job t3-backup --wait=true
  ;;
post-teardown)
  "$ROOT/spike/t3/bootstrap.sh"
  k -n "$NAMESPACE" scale deployment/t3-writer --replicas=0
  k -n "$NAMESPACE" wait --for=delete pod -l app=t3-writer --timeout=90s
  pod=$(db_pod)
  k -n "$NAMESPACE" cp "$STATE_DIR/t3.dump" "$pod:/tmp/t3.dump"
  k -n "$NAMESPACE" exec "$pod" -- env PGPASSWORD=t3-password pg_restore -U t3 -d t3 --clean --if-exists /tmp/t3.dump
  actual=$(sql 'select count(*), coalesce(max(seq),0) from ledger')
  [[ "$actual" == "$(cat "$STATE_DIR/backup.meta")" ]] || die "restore mismatch expected=$(cat "$STATE_DIR/backup.meta") actual=$actual"
  verify_ledger
  log "restore meta=$actual checksum=ok"
  k -n "$NAMESPACE" scale deployment/t3-writer --replicas=1
  k -n "$NAMESPACE" rollout status deployment/t3-writer --timeout=120s

  # Guarded apply refuses a missing claim. Raw SSA silently creates a fresh one.
  stop_all
  old=$(<"$STATE_DIR/postgres-data.uid")
  k -n "$NAMESPACE" delete pvc postgres-data --wait=true
  if "$ROOT/spike/t3/guarded-apply.sh"; then die "guard accepted missing PVC"; fi
  log "pvc_guard missing_claim=rejected mutation=none"
  ssa "$ROOT/spike/t3/bootstrap.yaml"
  ssa "$ROOT/spike/t3/fixture.yaml"
  k -n "$NAMESPACE" scale deployment/t3-postgres --replicas=1
  k -n "$NAMESPACE" wait --for=jsonpath='{.status.phase}'=Bound pvc/postgres-data --timeout=90s
  new=$(pvc_uid)
  [[ "$new" != "$old" ]] || die "unsafe apply did not create a new PVC"
  wait_db
  new_rows=$(sql "select count(*) from pg_tables where schemaname='public' and tablename='ledger'")
  old_rows=$(cut -d'|' -f1 "$STATE_DIR/backup.meta")
  [[ "$new_rows" == 0 ]] || die "replacement volume retained the ledger"
  log "unsafe_apply old_uid=$old new_uid=$new old_rows=$old_rows new_rows=$new_rows silent_data_loss=proved"
  ;;
*) die "usage: $0 pre-teardown|post-teardown" ;;
esac
