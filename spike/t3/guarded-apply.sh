#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/common.sh"
require_context
[[ -s "$STATE_DIR/postgres-data.uid" ]] || die "expected PVC UID is missing; run bootstrap explicitly"
expected=$(<"$STATE_DIR/postgres-data.uid")
actual=$(pvc_uid 2>/dev/null) || die "postgres-data PVC is missing; refusing apply"
[[ "$actual" == "$expected" ]] || die "postgres-data PVC UID changed: expected=$expected actual=$actual"
ssa "$ROOT/spike/t3/fixture.yaml"
log "guarded_apply pvc_uid=$actual result=accepted"
