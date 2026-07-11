#!/usr/bin/env bash
set -euo pipefail

context="${1:?usage: $0 <context>}"
kubectl --context "${context}" delete namespace t2-enforcement --ignore-not-found --wait >/dev/null
kubectl --context "${context}" create namespace t2-enforcement >/dev/null
trap 'kubectl --context "${context}" delete namespace t2-enforcement --ignore-not-found --wait=false >/dev/null' EXIT
kubectl --context "${context}" -n t2-enforcement run server --image=busybox:1.37.0 --labels=app=server --restart=Never -- sh -c 'echo ok >/tmp/index.html; httpd -f -p 8080 -h /tmp' >/dev/null
kubectl --context "${context}" -n t2-enforcement run client --image=busybox:1.37.0 --restart=Never -- sh -c 'sleep 600' >/dev/null
kubectl --context "${context}" -n t2-enforcement wait pod --all --for=condition=Ready --timeout=120s >/dev/null
server_ip="$(kubectl --context "${context}" -n t2-enforcement get pod server -o jsonpath='{.status.podIP}')"
probe() { kubectl --context "${context}" -n t2-enforcement exec client -- wget -q -T 2 -O /dev/null "http://${server_ip}:8080" >/dev/null 2>&1; }
probe || { echo 'VERDICT=invalid-baseline'; exit 1; }
kubectl --context "${context}" -n t2-enforcement apply -f - >/dev/null <<'YAML'
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: {name: deny-ingress}
spec: {podSelector: {matchLabels: {app: server}}, policyTypes: [Ingress]}
YAML
for _ in $(seq 1 30); do
  if ! probe; then echo 'VERDICT=enforced'; exit 0; fi
  sleep 1
done
echo 'VERDICT=not-enforced'
exit 1
