#!/usr/bin/env bash
set -Eeuo pipefail

PROOF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EVIDENCE_DIR="${EVIDENCE_DIR:-${PROOF_DIR}/evidence}"
REGISTRY_NAMESPACE="registry-node-pull-proof"
REGISTRY_SERVICE="registry"
CRANE_IMAGE="gcr.io/go-containerregistry/crane:debug"

mkdir -p "${EVIDENCE_DIR}"

log() {
  printf '[registry-node-pull] %s\n' "$*"
}

require_tools() {
  local tool
  for tool in awk diff docker find grep helm k3d kubectl openssl sed seq sha256sum tar timeout; do
    command -v "${tool}" >/dev/null || {
      printf 'Required tool is missing: %s\n' "${tool}" >&2
      exit 1
    }
  done
}

capture_environment() {
  local evidence_file="$1"
  {
    docker --version
    k3d version
    kubectl version --client
    helm version --short
    kubectl get nodes -o custom-columns='NAME:.metadata.name,KUBERNETES:.status.nodeInfo.kubeletVersion'
    sysctl fs.inotify.max_user_instances 2>/dev/null || true
  } >"${evidence_file}"
}

assert_exact_nodes() {
  local cluster_name="$1"
  shift
  local actual
  local expected
  actual="$(cluster_nodes "${cluster_name}")"
  expected="$(printf '%s\n' "$@" | sort)"
  if [[ "${actual}" != "${expected}" ]]; then
    printf 'Unexpected node set.\nExpected:\n%s\nActual:\n%s\n' "${expected}" "${actual}" >&2
    return 1
  fi
}

delete_cluster() {
  local cluster_name="$1"
  k3d cluster delete "${cluster_name}" >/dev/null 2>&1 || true
}

cluster_nodes() {
  local cluster_name="$1"
  docker ps --filter "label=app=k3d" --filter "label=k3d.cluster=${cluster_name}" \
    --format '{{.Names}}' | grep -E -- '-(server|agent)-[0-9]+$' | sort
}

wait_for_cluster() {
  kubectl wait --for=condition=Ready nodes --all --timeout=180s
}

install_registry() {
  local work_dir="$1"

  kubectl create namespace "${REGISTRY_NAMESPACE}"
  REGISTRY_CHART_DIR="${work_dir}/registry-chart"
  export REGISTRY_CHART_DIR
  mkdir -p "${REGISTRY_CHART_DIR}/templates"
  cat >"${REGISTRY_CHART_DIR}/Chart.yaml" <<'EOF'
apiVersion: v2
name: registry-node-pull-proof
version: 0.1.0
EOF
  cat >"${REGISTRY_CHART_DIR}/values.yaml" <<'EOF'
marker: install
EOF
  cat >"${REGISTRY_CHART_DIR}/templates/service.yaml" <<'EOF'
apiVersion: v1
kind: Service
metadata:
  name: registry
  annotations:
    proof.example/helm-marker: {{ .Values.marker | quote }}
spec:
  type: ClusterIP
  selector:
    app: registry-node-pull-proof
  ports:
    - name: https
      port: 443
      targetPort: 443
EOF
  helm upgrade --install registry-proof "${REGISTRY_CHART_DIR}" \
    --namespace "${REGISTRY_NAMESPACE}"

  REGISTRY_CLUSTER_IP="$(kubectl -n "${REGISTRY_NAMESPACE}" get service "${REGISTRY_SERVICE}" -o jsonpath='{.spec.clusterIP}')"
  REGISTRY_HOST="${REGISTRY_CLUSTER_IP//./-}.sslip.io"
  export REGISTRY_CLUSTER_IP REGISTRY_HOST

  openssl req -x509 -newkey rsa:2048 -nodes -days 2 \
    -keyout "${work_dir}/ca.key" -out "${work_dir}/ca.crt" \
    -subj '/CN=registry-node-pull proof CA' >/dev/null 2>&1
  openssl req -newkey rsa:2048 -nodes \
    -keyout "${work_dir}/tls.key" -out "${work_dir}/tls.csr" \
    -subj "/CN=${REGISTRY_HOST}" >/dev/null 2>&1
  printf 'subjectAltName=DNS:%s\nextendedKeyUsage=serverAuth\n' "${REGISTRY_HOST}" >"${work_dir}/tls.ext"
  openssl x509 -req -days 2 -sha256 -in "${work_dir}/tls.csr" \
    -CA "${work_dir}/ca.crt" -CAkey "${work_dir}/ca.key" -CAcreateserial \
    -extfile "${work_dir}/tls.ext" -out "${work_dir}/tls.crt" >/dev/null 2>&1

  kubectl -n "${REGISTRY_NAMESPACE}" create secret tls registry-tls \
    --cert="${work_dir}/tls.crt" --key="${work_dir}/tls.key"
  kubectl -n "${REGISTRY_NAMESPACE}" apply -f - <<'EOF'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: registry
spec:
  replicas: 1
  selector:
    matchLabels:
      app: registry-node-pull-proof
  template:
    metadata:
      labels:
        app: registry-node-pull-proof
    spec:
      containers:
        - name: registry
          image: registry:2
          env:
            - name: REGISTRY_HTTP_ADDR
              value: 0.0.0.0:443
            - name: REGISTRY_HTTP_TLS_CERTIFICATE
              value: /tls/tls.crt
            - name: REGISTRY_HTTP_TLS_KEY
              value: /tls/tls.key
          ports:
            - containerPort: 443
          volumeMounts:
            - name: tls
              mountPath: /tls
              readOnly: true
      volumes:
        - name: tls
          secret:
            secretName: registry-tls
EOF
  kubectl -n "${REGISTRY_NAMESPACE}" rollout status deployment/registry --timeout=180s
}

trust_test_ca_on_nodes() {
  local cluster_name="$1"
  local ca_file="$2"
  local node
  while read -r node; do
    docker cp "${ca_file}" "${node}:/tmp/registry-node-pull-proof.crt" >/dev/null
    docker exec "${node}" sh -c \
      'cat /tmp/registry-node-pull-proof.crt >>/etc/ssl/certs/ca-certificates.crt'
  done < <(cluster_nodes "${cluster_name}")
  while read -r node; do
    docker restart "${node}" >/dev/null
  done < <(cluster_nodes "${cluster_name}")
  sleep 5
  kubectl wait --for=condition=Ready nodes --all --timeout=180s
  kubectl -n "${REGISTRY_NAMESPACE}" rollout status deployment/registry --timeout=180s
}

assert_no_runtime_registry_configuration() {
  local cluster_name="$1"
  local evidence_file="$2"
  local node
  : >"${evidence_file}"
  while read -r node; do
    {
      printf 'NODE=%s\n' "${node}"
      docker exec "${node}" sh -c \
        'find /etc/rancher /var/lib/rancher/k3s/agent/etc/containerd -type f \( -name "registries.yaml" -o -name "hosts.toml" \) -print 2>/dev/null || true'
      docker exec "${node}" sh -c \
        "grep -RniF '${REGISTRY_HOST}' /var/lib/rancher/k3s/agent/etc/containerd /etc/rancher 2>/dev/null || true"
    } >>"${evidence_file}"
  done < <(cluster_nodes "${cluster_name}")
  if grep -Eq '(^|/)(registries\.yaml|hosts\.toml)$|sslip\.io' "${evidence_file}"; then
    printf 'Unexpected registry runtime configuration found:\n' >&2
    cat "${evidence_file}" >&2
    return 1
  fi
}

capture_node_resolution_and_tls() {
  local cluster_name="$1"
  local ca_file="$2"
  local evidence_file="$3"
  local node
  local reached
  : >"${evidence_file}"
  while read -r node; do
    {
      printf 'NODE=%s\n' "${node}"
      docker exec "${node}" nslookup "${REGISTRY_HOST}"
      reached='no'
      for _ in $(seq 1 12); do
        if timeout 10s docker run --rm --network "container:${node}" \
          -e SSL_CERT_FILE=/proof-ca.crt -v "${ca_file}:/proof-ca.crt:ro" \
          "${CRANE_IMAGE}" catalog "${REGISTRY_HOST}"; then
          reached='yes'
          break
        fi
        sleep 2
      done
      [[ "${reached}" == 'yes' ]]
      printf '\n'
    } >>"${evidence_file}" 2>&1
  done < <(cluster_nodes "${cluster_name}")
}

push_unique_image() {
  local cluster_name="$1"
  local work_dir="$2"
  local tag="$3"
  local server_node="k3d-${cluster_name}-server-0"

  mkdir -p "${work_dir}/layer"
  printf 'proof run %s\n' "${tag}" >"${work_dir}/layer/proof.txt"
  tar -C "${work_dir}/layer" -cf "${work_dir}/proof-layer.tar" proof.txt
  IMAGE_REF="${REGISTRY_HOST}/test:${tag}"
  export IMAGE_REF

  docker run --rm --network "container:${server_node}" \
    -e SSL_CERT_FILE=/work/ca.crt \
    -v "${work_dir}:/work:ro" \
    "${CRANE_IMAGE}" append \
    --base docker.io/library/busybox:1.36.1 \
    --new_layer /work/proof-layer.tar \
    --new_tag "${IMAGE_REF}"
}

push_unique_image_from_pod() {
  local work_dir="$1"
  local tag="$2"
  local registry_pod_ip

  mkdir -p "${work_dir}/layer"
  printf 'proof run %s\n' "${tag}" >"${work_dir}/layer/proof.txt"
  tar -C "${work_dir}/layer" -cf "${work_dir}/proof-layer.tar" proof.txt
  IMAGE_REF="${REGISTRY_HOST}/test:${tag}"
  export IMAGE_REF
  registry_pod_ip="$(kubectl -n "${REGISTRY_NAMESPACE}" get pod \
    -l app=registry-node-pull-proof -o jsonpath='{.items[0].status.podIP}')"

  kubectl -n "${REGISTRY_NAMESPACE}" create secret generic proof-push-files \
    --from-file=ca.crt="${work_dir}/ca.crt" \
    --from-file=proof-layer.tar="${work_dir}/proof-layer.tar"
  kubectl -n "${REGISTRY_NAMESPACE}" apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: push-image
spec:
  restartPolicy: Never
  hostAliases:
    - ip: ${registry_pod_ip}
      hostnames:
        - ${REGISTRY_HOST}
  containers:
    - name: crane
      image: ${CRANE_IMAGE}
      env:
        - name: SSL_CERT_FILE
          value: /work/ca.crt
      args:
        - append
        - --base
        - docker.io/library/busybox:1.36.1
        - --new_layer
        - /work/proof-layer.tar
        - --new_tag
        - ${IMAGE_REF}
      volumeMounts:
        - name: work
          mountPath: /work
          readOnly: true
  volumes:
    - name: work
      secret:
        secretName: proof-push-files
EOF
  kubectl -n "${REGISTRY_NAMESPACE}" wait --for=jsonpath='{.status.phase}'=Succeeded \
    pod/push-image --timeout=180s
}

pull_on_every_node() {
  local cluster_name="$1"
  local evidence_file="$2"
  local node
  local pod_name

  : >"${evidence_file}"
  while read -r node; do
    pod_name="pull-${node//_/-}"
    kubectl apply -f - <<EOF
apiVersion: v1
kind: Pod
metadata:
  name: ${pod_name}
  namespace: ${REGISTRY_NAMESPACE}
spec:
  restartPolicy: Never
  nodeSelector:
    kubernetes.io/hostname: ${node}
  containers:
    - name: proof
      image: ${IMAGE_REF}
      imagePullPolicy: Always
      command: ["/bin/sh", "-c", "sleep 600"]
EOF
    kubectl -n "${REGISTRY_NAMESPACE}" wait --for=condition=Ready "pod/${pod_name}" --timeout=180s
  done < <(cluster_nodes "${cluster_name}")

  {
    kubectl -n "${REGISTRY_NAMESPACE}" get pods -o wide
    printf '\nPOD IMAGE IDS\n'
    kubectl -n "${REGISTRY_NAMESPACE}" get pods \
      -o custom-columns='NAME:.metadata.name,NODE:.spec.nodeName,PHASE:.status.phase,IMAGE:.spec.containers[0].image,IMAGE_ID:.status.containerStatuses[0].imageID'
  } >"${evidence_file}"
}

capture_registry_pull_logs() {
  local evidence_file="$1"
  kubectl -n "${REGISTRY_NAMESPACE}" logs deployment/registry \
    | grep -E 'test|/v2/' >"${evidence_file}"
}

assert_containerd_manifest_requests() {
  local evidence_file="$1"
  local expected_count="$2"
  local tag="${IMAGE_REF##*:}"
  local actual_count
  actual_count="$(grep -E "HEAD /v2/test/manifests/${tag} .* 200 .*containerd/" \
    "${evidence_file}" | wc -l)"
  if [[ "${actual_count}" -lt "${expected_count}" ]]; then
    printf 'Expected at least %s successful containerd manifest requests for %s; found %s\n' \
      "${expected_count}" "${tag}" "${actual_count}" >&2
    return 1
  fi
}

capture_service_evidence() {
  local evidence_file="$1"
  {
    kubectl -n "${REGISTRY_NAMESPACE}" get service "${REGISTRY_SERVICE}" -o wide
    kubectl -n "${REGISTRY_NAMESPACE}" get service "${REGISTRY_SERVICE}" \
      -o jsonpath='TYPE={.spec.type} CLUSTER_IP={.spec.clusterIP} EXTERNAL_IPS={.spec.externalIPs}{"\n"}'
    printf 'REGISTRY_INGRESS_NAMES='
    kubectl get ingress -A -o jsonpath='{range .items[?(@.metadata.name=="registry")]}{.metadata.namespace}/{.metadata.name}{" "}{end}'
    printf '\n'
  } >"${evidence_file}"
}
