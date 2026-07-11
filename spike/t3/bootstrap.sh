#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/common.sh"
require_context
ssa "$ROOT/spike/t3/bootstrap.yaml"
ssa "$ROOT/spike/t3/fixture.yaml"
start_all
pvc_uid >"$STATE_DIR/postgres-data.uid"
log "bootstrap pvc_uid=$(cat "$STATE_DIR/postgres-data.uid") storage_class=$(k -n "$NAMESPACE" get pvc postgres-data -o jsonpath='{.spec.storageClassName}')"
