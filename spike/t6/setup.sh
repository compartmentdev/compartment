#!/usr/bin/env bash
set -euo pipefail

context=k3d-cpt-t6
docker exec k3d-cpt-t6-server-0 sh -c 'rm -rf /var/lib/t6-vector; mkdir -p /var/lib/t6-vector'
kubectl --context "$context" apply -f "$(dirname "$0")/vector.yaml"
kubectl --context "$context" -n t6 rollout status daemonset/vector --timeout=120s
kubectl --context "$context" apply -f "$(dirname "$0")/talker.yaml"
kubectl --context "$context" -n t6 rollout status deployment/talker --timeout=120s
docker exec k3d-cpt-t6-server-0 sh -c 'du -sb /var/log/pods /var/lib/t6-vector'
