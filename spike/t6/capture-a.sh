#!/usr/bin/env bash
set -euo pipefail

context=k3d-cpt-t6
namespace=t6
pod=$1
out=$2
mkdir -p "$(dirname "$out")"

kubectl --context "$context" -n "$namespace" logs -f "$pod" -c talker --timestamps >"$out.follow" 2>"$out.follow.err" &
follow_pid=$!
cleanup() { kill "$follow_pid" 2>/dev/null || true; wait "$follow_pid" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
wait "$follow_pid" || true
kubectl --context "$context" -n "$namespace" logs "$pod" -c talker --timestamps >>"$out.final" 2>"$out.final.err" || true
kubectl --context "$context" -n "$namespace" logs "$pod" -c talker --previous --timestamps >>"$out.previous" 2>"$out.previous.err" || true
cat "$out.follow" "$out.final" "$out.previous" 2>/dev/null | sed -n 's/^.*\(T6|.*\)$/\1/p' | sort -u >"$out.unique"
