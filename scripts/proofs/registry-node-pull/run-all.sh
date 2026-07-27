#!/usr/bin/env bash
set -Eeuo pipefail

PROOF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

"${PROOF_DIR}/case-a.sh"
"${PROOF_DIR}/case-b.sh"
"${PROOF_DIR}/case-c.sh"

printf '\nProof verdicts:\n'
for case_name in case-a case-b case-c; do
  printf '%s: ' "${case_name}"
  tr '\n' ' ' <"${PROOF_DIR}/evidence/${case_name}/verdict.txt"
  printf '\n'
done
