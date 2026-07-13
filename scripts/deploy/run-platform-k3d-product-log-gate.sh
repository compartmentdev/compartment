#!/usr/bin/env bash
set -euo pipefail

context="k3d-compartment-e2e"
platform_namespace="compartment"
observability_namespace="compartment-observability"
load_namespace="cpt-p7-buffer-gate"
platform_name="compartment-compartment"
quota_max_bytes="1073741824"
buffer_min_bytes="209715200"
buffer_max_bytes="285212672"
original_quota=""

psql() {
  kubectl --context "$context" --namespace "$platform_namespace" exec "deployment/${platform_name}-postgres" -- \
    psql --username postgres --dbname compartment --tuples-only --no-align --command "$1"
}

cleanup() {
  if [[ -n "$original_quota" ]]; then
    psql "update product_log_store_quota set used_bytes = ${original_quota} where id = 'global';" >/dev/null || true
  fi
  kubectl --context "$context" delete namespace "$observability_namespace" --ignore-not-found --wait=false >/dev/null || true
  kubectl --context "$context" delete namespace "$load_namespace" --ignore-not-found --wait=false >/dev/null || true
}
trap cleanup EXIT

runtime_control_token="$({
  kubectl --context "$context" --namespace "$platform_namespace" get secret "$platform_name" \
    --output 'jsonpath={.data.runtime-control-token}'
} | base64 --decode)"
ingest_token="$(node -e 'const { createHmac } = require("node:crypto"); process.stdout.write(createHmac("sha256", process.argv[1]).update("compartment-product-log-ingest-v1").digest("base64url"));' "$runtime_control_token")"

kubectl --context "$context" apply --filename packages/worker/manifests/product-log-agent.yaml
kubectl --context "$context" --namespace "$observability_namespace" create secret generic compartment-log-agent \
  --from-literal "ingest-url=http://${platform_name}-api.${platform_namespace}.svc.cluster.local:39444/internal/kubernetes/logs" \
  --from-literal "ingest-token=${ingest_token}" \
  --dry-run=client --output yaml | kubectl --context "$context" apply --filename -
kubectl --context "$context" --namespace "$observability_namespace" rollout status \
  daemonset/compartment-log-agent --timeout=3m

original_quota="$(psql "select used_bytes from product_log_store_quota where id = 'global';" | tr -d '[:space:]')"
if [[ ! "$original_quota" =~ ^[0-9]+$ ]]; then
  echo 'Unable to read the product-log quota.' >&2
  exit 1
fi
psql "update product_log_store_quota set used_bytes = ${quota_max_bytes} where id = 'global';" >/dev/null

kubectl --context "$context" create namespace "$load_namespace"
# The JavaScript snippet is intentionally single-quoted so Bash cannot expand template expressions.
# shellcheck disable=SC2016
kubectl --context "$context" --namespace "$load_namespace" run app-buffer-load \
  --image=public.ecr.aws/docker/library/node:24.15.0-bookworm \
  --restart=Never \
  --command -- node -e '
    const line = "p7-bounded-buffer-" + "x".repeat(4000);
    let index = 0;
    const writeBatch = () => {
      if (index >= 75000) {
        setInterval(() => {}, 60000);
        return;
      }
      for (let count = 0; count < 1000; count += 1) {
        if (!process.stdout.write(`${line}-${index++}\n`)) {
          process.stdout.once("drain", writeBatch);
          return;
        }
      }
      setImmediate(writeBatch);
    };
    writeBatch();
  '
kubectl --context "$context" --namespace "$load_namespace" wait pod/app-buffer-load \
  --for=condition=Ready --timeout=3m

agent_pod="$(kubectl --context "$context" --namespace "$observability_namespace" get pod \
  --selector app.kubernetes.io/name=compartment-log-agent --output 'jsonpath={.items[0].metadata.name}')"
agent_node="$(kubectl --context "$context" --namespace "$observability_namespace" get pod "$agent_pod" \
  --output 'jsonpath={.spec.nodeName}')"
buffer_bytes="0"
for _attempt in {1..120}; do
  buffer_bytes="$(docker exec "$agent_node" du -sb /var/lib/compartment/log-agent | awk '{print $1}')"
  if (( buffer_bytes >= buffer_min_bytes )); then
    break
  fi
  sleep 1
done
if (( buffer_bytes < buffer_min_bytes || buffer_bytes > buffer_max_bytes )); then
  echo "Product-log buffer did not backpressure within bounds: bytes=${buffer_bytes}." >&2
  exit 1
fi

kubectl --context "$context" --request-timeout=5s get --raw=/readyz >/dev/null
kubectl --context "$context" --namespace "$platform_namespace" rollout status \
  "deployment/${platform_name}-api" --timeout=30s
kubectl --context "$context" --namespace "$load_namespace" get pod app-buffer-load \
  --output 'jsonpath={.status.containerStatuses[0].ready}' | grep --quiet '^true$'
kubectl --context "$context" get deployments --all-namespaces --output json | node -e '
  let input = "";
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    const degraded = JSON.parse(input).items.filter((deployment) =>
      deployment.metadata.namespace.startsWith("cpt-") &&
      deployment.status.availableReplicas !== deployment.spec.replicas,
    );
    if (degraded.length > 0) process.exit(1);
  });
'
current_quota="$(psql "select used_bytes from product_log_store_quota where id = 'global';" | tr -d '[:space:]')"
if [[ "$current_quota" != "$quota_max_bytes" ]]; then
  echo "Product-log quota changed while ingest was backpressured: ${current_quota}." >&2
  exit 1
fi

echo "product_log_gate buffer_bytes=${buffer_bytes} quota_bytes=${current_quota} status=ok"
