#!/usr/bin/env bash
set -euo pipefail

proof_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$proof_dir/../../.." && pwd)"
cluster_name="${BROKER_DNS01_CLUSTER_NAME:-proof-broker-dns01}"
context="k3d-$cluster_name"
evidence_dir="$proof_dir/evidence"
broker_host_url="http://127.0.0.1:19090"
broker_cluster_url="http://broker.proof.svc.cluster.local:3000"
reservation_token="proof-reservation-authority"
proof_control_token="proof-control-authority"
solver_image="compartment-proof/broker-dns01-solver:v1.21.0"
dns_host="127.0.0.1"
dns_port="1053"
original_inotify_instances="$(sysctl -n fs.inotify.max_user_instances)"

restore_inotify_limit() {
  if [[ "$(sysctl -n fs.inotify.max_user_instances)" != "$original_inotify_instances" ]]; then
    sysctl -q -w "fs.inotify.max_user_instances=$original_inotify_instances"
  fi
}
trap restore_inotify_limit EXIT
if (( original_inotify_instances < 512 )); then
  sysctl -q -w fs.inotify.max_user_instances=512
fi

mkdir -p "$evidence_dir"
for evidence_file in \
  case-a-certificate.yaml case-a-pebble.txt case-a-txt-dig.txt case-a-txt-history.json case-a-broker.json \
  case-b-direct-denial.txt case-b-reservation-denial.txt case-b-certificate.yaml case-b-challenge.json \
  case-b-broker.json case-b-solver.txt case-b-target-denial.txt case-b-txt-dig.txt case-b-forged-txt-dig.txt \
  case-c-a.txt case-c-aaaa.txt case-c-cname.txt case-c-hostname-a.txt case-c-hostname-aaaa.txt \
  case-c-broker.json case-d-before.txt case-d-after.txt case-d-certificate.yaml \
  case-d-broker.json case-d-pebble.txt run-summary.txt versions.txt; do
  : > "$evidence_dir/$evidence_file"
done

"$proof_dir/cleanup.sh"
k3d cluster create "$cluster_name" \
  --agents 0 \
  --servers 1 \
  --image rancher/k3s@sha256:d8f05b9043d136c3fb01d6cf677caaef304568b8c99bdd359b86d3d7286de1df \
  --k3s-arg '--disable=traefik@server:0' \
  --port "$dns_port:30053/udp@server:0" \
  --port "$dns_port:30053/tcp@server:0" \
  --port '19090:30090@server:0' \
  --wait

BUILDKIT_PROGRESS=plain docker build --tag "$solver_image" "$proof_dir/solver"
k3d image import --cluster "$cluster_name" "$solver_image"

kubectl --context "$context" create namespace proof
kubectl --context "$context" --namespace proof create configmap broker-source \
  --from-file=broker.mjs="$proof_dir/broker.mjs"
kubectl --context "$context" apply --filename "$proof_dir/manifests/infrastructure.yaml"
kubectl --context "$context" --namespace proof wait deployment --all \
  --for=condition=Available --timeout=4m

cert_manager_manifest="$proof_dir/.cert-manager-v1.21.0.yaml"
cert_manager_manifest_sha256="6e499c3f1ab356abe79a7853911f80cb09c213885bfdf81092fdff142ba63c4a"
curl --fail --location --silent --show-error \
  --output "$cert_manager_manifest" \
  https://github.com/cert-manager/cert-manager/releases/download/v1.21.0/cert-manager.yaml
echo "$cert_manager_manifest_sha256  $cert_manager_manifest" | sha256sum --check --status
kubectl --context "$context" apply --filename "$cert_manager_manifest"
kubectl --context "$context" --namespace cert-manager wait deployment --all \
  --for=condition=Available --timeout=5m
cert_manager_images="$(kubectl --context "$context" --namespace cert-manager get deployment \
  -o jsonpath='{..image}')"
while read -r cert_manager_image; do
  [[ "$cert_manager_image" == *":v1.21.0" ]]
done < <(tr ' ' '\n' <<<"$cert_manager_images")

dns_cluster_ip="$(kubectl --context "$context" --namespace proof get service challtestsrv -o jsonpath='{.spec.clusterIP}')"
kubectl --context "$context" --namespace cert-manager patch deployment cert-manager --type=json \
  --patch="[
    {\"op\":\"add\",\"path\":\"/spec/template/spec/containers/0/args/-\",\"value\":\"--dns01-recursive-nameservers-only\"},
    {\"op\":\"add\",\"path\":\"/spec/template/spec/containers/0/args/-\",\"value\":\"--dns01-recursive-nameservers=${dns_cluster_ip}:53\"}
  ]"
kubectl --context "$context" --namespace cert-manager rollout status deployment cert-manager --timeout=4m

kubectl --context "$context" apply --filename "$proof_dir/manifests/webhook.yaml"
kubectl --context "$context" --namespace proof wait certificate broker-dns01-webhook-tls \
  --for=condition=Ready --timeout=2m
kubectl --context "$context" --namespace proof wait deployment broker-dns01-webhook \
  --for=condition=Available --timeout=3m
kubectl --context "$context" wait apiservice v1alpha1.dns01.proof.compartment.test \
  --for=condition=Available --timeout=2m

proof_state() {
  curl --fail --silent --show-error \
    --header "x-proof-control: $proof_control_token" \
    "$broker_host_url/__proof/state"
}
proof_post() {
  local path="$1"
  curl --fail --silent --show-error --request POST \
    --header "x-proof-control: $proof_control_token" \
    "$broker_host_url$path"
}
audit_event_count() {
  local event="$1"
  proof_state | python3 -c \
    'import json, sys; event=sys.argv[1]; print(sum(1 for item in json.load(sys.stdin)["audit"] if item["event"] == event))' \
    "$event"
}

z1_json="$(curl --fail --silent --show-error \
  --header "authorization: Bearer $reservation_token" \
  --header 'idempotency-key: proof-installation-z1' \
  --header 'content-type: application/json' \
  --data '{"installationId":"proof-installation-z1","requestedLabel":"z1"}' "$broker_host_url/allocations")"
z2_json="$(curl --fail --silent --show-error \
  --header "authorization: Bearer $reservation_token" \
  --header 'idempotency-key: proof-installation-z2' \
  --header 'content-type: application/json' \
  --data '{"installationId":"proof-installation-z2","requestedLabel":"z2"}' "$broker_host_url/allocations")"
read_json_field() {
  local field="$1"
  python3 -c 'import json, sys; print(json.load(sys.stdin)[sys.argv[1]])' "$field"
}
z1_id="$(read_json_field allocationId <<<"$z1_json")"
z1_token="$(read_json_field scopedToken <<<"$z1_json")"
z2_id="$(read_json_field allocationId <<<"$z2_json")"
z2_token="$(read_json_field scopedToken <<<"$z2_json")"

apply_issuer() {
  local name="$1"
  local allocation_id="$2"
  local token="$3"
  kubectl --context "$context" --namespace proof apply --filename - <<EOF
apiVersion: cert-manager.io/v1
kind: Issuer
metadata:
  name: $name
spec:
  acme:
    email: proof@compartment.test
    server: https://pebble.proof.svc.cluster.local:14000/dir
    skipTLSVerify: true
    privateKeySecretRef:
      name: $name-account
    solvers:
      - dns01:
          webhook:
            groupName: dns01.proof.compartment.test
            solverName: managed-domain-broker
            config:
              brokerURL: $broker_cluster_url
              allocationId: $allocation_id
              token: $token
EOF
}

apply_certificate() {
  local name="$1"
  local issuer="$2"
  local dns_name="${3:-*.z1.proof.test}"
  kubectl --context "$context" --namespace proof apply --filename - <<EOF
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: $name
spec:
  secretName: $name-tls
  issuerRef:
    name: $issuer
  dnsNames:
    - '$dns_name'
EOF
}

apply_issuer z1-issuer "$z1_id" "$z1_token"
apply_certificate wildcard-z1 z1-issuer
for _ in $(seq 1 60); do
  active_state="$(proof_state)"
  if python3 -c \
    'import json, sys; state=json.load(sys.stdin); raise SystemExit(0 if any(a["challenges"] for a in state["allocations"]) else 1)' \
    <<<"$active_state"; then
    break
  fi
  sleep 1
done
dig @"$dns_host" -p "$dns_port" TXT _acme-challenge.z1.proof.test +noall +answer \
  | tee "$evidence_dir/case-a-txt-dig.txt"
grep -Fq '_acme-challenge.z1.proof.test.' "$evidence_dir/case-a-txt-dig.txt"
kubectl --context "$context" --namespace proof wait certificate wildcard-z1 \
  --for=condition=Ready --timeout=4m
kubectl --context "$context" --namespace proof get certificate wildcard-z1 -o yaml \
  | tee "$evidence_dir/case-a-certificate.yaml"
kubectl --context "$context" --namespace proof logs deployment/pebble \
  | tee "$evidence_dir/case-a-pebble.txt"
kubectl --context "$context" --namespace proof get --raw \
  "/api/v1/namespaces/proof/services/http:challtestsrv:8055/proxy/dns-request-history" >/dev/null 2>&1 || true
proof_state \
  | python3 -m json.tool | tee "$evidence_dir/case-a-broker.json"
curl --fail --silent --show-error \
  --header "x-proof-control: $proof_control_token" \
  "$broker_host_url/__proof/dns-history?host=_acme-challenge.z1.proof.test" \
  | python3 -m json.tool | tee "$evidence_dir/case-a-txt-history.json"

set +e
reservation_denial_status="$(curl --silent --output "$evidence_dir/case-b-reservation-denial.txt" \
  --write-out '%{http_code}' \
  --header 'idempotency-key: attacker-installation' \
  --header 'content-type: application/json' \
  --data '{"installationId":"attacker-installation","requestedLabel":"z1"}' \
  "$broker_host_url/allocations")"
set -e
[[ "$reservation_denial_status" == "401" ]]
printf '\nHTTP %s\n' "$reservation_denial_status" >> "$evidence_dir/case-b-reservation-denial.txt"

set +e
direct_denial_status="$(curl --silent --output "$evidence_dir/case-b-direct-denial.txt" \
  --write-out '%{http_code}' --request POST \
  --header "authorization: Bearer $z2_token" \
  --header 'content-type: application/json' \
  --data '{"name":"_acme-challenge.z1.proof.test.","value":"forbidden-direct"}' \
  "$broker_host_url/allocations/$z1_id/challenges")"
set -e
[[ "$direct_denial_status" == "403" ]]
printf '\nHTTP %s\n' "$direct_denial_status" >> "$evidence_dir/case-b-direct-denial.txt"
dig @"$dns_host" -p "$dns_port" TXT _acme-challenge.z1.proof.test +noall +comments +answer \
  | tee "$evidence_dir/case-b-txt-dig.txt"
! grep -Fq forbidden-direct "$evidence_dir/case-b-txt-dig.txt"
denials_before_forged="$(audit_event_count authority_denied)"

apply_issuer forged-z1-issuer "$z1_id" "$z2_token"
apply_certificate wildcard-z1-forged forged-z1-issuer '*.forged.z1.proof.test'
if kubectl --context "$context" --namespace proof wait certificate wildcard-z1-forged \
  --for=condition=Ready --timeout=45s; then
  echo 'forged Certificate unexpectedly became Ready' >&2
  exit 1
fi
kubectl --context "$context" --namespace proof get certificate wildcard-z1-forged -o yaml \
  | tee "$evidence_dir/case-b-certificate.yaml"
forged_challenge="$(kubectl --context "$context" --namespace proof get challenge -o name \
  | grep 'wildcard-z1-forged' | head -1)"
[[ -n "$forged_challenge" ]]
kubectl --context "$context" --namespace proof get "$forged_challenge" -o json \
  | python3 -c \
    'import json, sys; challenge=json.load(sys.stdin); del challenge["spec"]["solver"]["dns01"]["webhook"]["config"]["token"]; challenge["spec"]["key"]="[redacted ACME key]"; challenge["spec"]["token"]="[redacted ACME token]"; json.dump(challenge, sys.stdout, indent=2); print()' \
  | tee "$evidence_dir/case-b-challenge.json"
grep -Fq "$broker_cluster_url/allocations/$z1_id/challenges" "$evidence_dir/case-b-challenge.json"
grep -Fq 'returned 403' "$evidence_dir/case-b-challenge.json"
grep -Fq 'token is not authorized for this allocation' "$evidence_dir/case-b-challenge.json"
(( "$(audit_event_count authority_denied)" > denials_before_forged ))
dig @"$dns_host" -p "$dns_port" TXT _acme-challenge.forged.z1.proof.test +noall +comments +answer \
  | tee "$evidence_dir/case-b-forged-txt-dig.txt"
! grep -Eq $'\tIN\tTXT\t' "$evidence_dir/case-b-forged-txt-dig.txt"
kubectl --context "$context" --namespace proof logs deployment/broker-dns01-webhook \
  | tee "$evidence_dir/case-b-solver.txt"

set +e
target_denial_status="$(curl --silent --output "$evidence_dir/case-b-target-denial.txt" \
  --write-out '%{http_code}' --request PUT \
  --header "authorization: Bearer $z1_token" \
  --header 'content-type: application/json' \
  --data '{"targets":[{"type":"A","value":"9.9.9.9"}]}' \
  "$broker_host_url/allocations/$z2_id/targets")"
set -e
[[ "$target_denial_status" == "403" ]]
printf '\nHTTP %s\n' "$target_denial_status" >> "$evidence_dir/case-b-target-denial.txt"
case_b_state="$(proof_state)"
python3 -c \
  'import json, sys; allocation=sys.argv[1]; state=json.load(sys.stdin); match=next(a for a in state["allocations"] if a["id"] == allocation); raise SystemExit(0 if match["targets"] == [] else 1)' \
  "$z2_id" <<<"$case_b_state"
python3 -m json.tool <<<"$case_b_state" | tee "$evidence_dir/case-b-broker.json"

curl --fail --silent --show-error --request PUT \
  --header "authorization: Bearer $z1_token" \
  --header 'content-type: application/json' \
  --data '{"targets":[{"type":"A","value":"1.2.3.4"},{"type":"AAAA","value":"2001:db8::1"},{"type":"hostname","value":"lb.example.com"}]}' \
  "$broker_host_url/allocations/$z1_id/targets" >/dev/null
dig @"$dns_host" -p "$dns_port" A a.z1.proof.test +noall +comments +answer \
  | sed -e '${/^$/d;}' \
  | tee "$evidence_dir/case-c-a.txt"
dig @"$dns_host" -p "$dns_port" AAAA aaaa.z1.proof.test +noall +comments +answer \
  | sed -e '${/^$/d;}' \
  | tee "$evidence_dir/case-c-aaaa.txt"
dig @"$dns_host" -p "$dns_port" CNAME hostname.z1.proof.test +noall +comments +answer \
  | sed -e '${/^$/d;}' \
  | tee "$evidence_dir/case-c-cname.txt"
dig @"$dns_host" -p "$dns_port" A hostname.z1.proof.test +noall +comments +answer \
  | sed -e '${/^$/d;}' \
  | tee "$evidence_dir/case-c-hostname-a.txt"
dig @"$dns_host" -p "$dns_port" AAAA hostname.z1.proof.test +noall +comments +answer \
  | sed -e '${/^$/d;}' \
  | tee "$evidence_dir/case-c-hostname-aaaa.txt"
grep -Fq '1.2.3.4' "$evidence_dir/case-c-a.txt"
grep -Fq '2001:db8::1' "$evidence_dir/case-c-aaaa.txt"
grep -Fq 'lb.example.com.' "$evidence_dir/case-c-cname.txt"
! grep -Eq $'\tIN\tA\t|\tIN\tAAAA\t' "$evidence_dir/case-c-cname.txt"
grep -Fq $'\tIN\tCNAME\tlb.example.com.' "$evidence_dir/case-c-hostname-a.txt"
grep -Fq $'\tIN\tCNAME\tlb.example.com.' "$evidence_dir/case-c-hostname-aaaa.txt"
! grep -Eq $'\tIN\tA\t' "$evidence_dir/case-c-hostname-a.txt"
! grep -Eq $'\tIN\tAAAA\t' "$evidence_dir/case-c-hostname-aaaa.txt"
proof_state \
  | python3 -m json.tool | tee "$evidence_dir/case-c-broker.json"

curl --fail --silent --show-error --request POST \
  --header "authorization: Bearer $z1_token" \
  --header 'content-type: application/json' \
  --data '{"name":"_acme-challenge.replay.z1.proof.test.","value":"active-through-restart"}' \
  "$broker_host_url/allocations/$z1_id/challenges" >/dev/null
dig @"$dns_host" -p "$dns_port" TXT _acme-challenge.replay.z1.proof.test +noall +answer \
  | tee "$evidence_dir/case-d-before.txt"
grep -Fq active-through-restart "$evidence_dir/case-d-before.txt"
proof_post /__proof/clear-backend >/dev/null
! dig @"$dns_host" -p "$dns_port" TXT _acme-challenge.replay.z1.proof.test +short | grep -q .
! dig @"$dns_host" -p "$dns_port" A a.z1.proof.test +short | grep -q .
! dig @"$dns_host" -p "$dns_port" AAAA aaaa.z1.proof.test +short | grep -q .
! dig @"$dns_host" -p "$dns_port" CNAME hostname.z1.proof.test +short | grep -q .
broker_pod="$(kubectl --context "$context" --namespace proof get pod -l app=broker -o jsonpath='{.items[0].metadata.name}')"
restart_before="$(kubectl --context "$context" --namespace proof get pod "$broker_pod" -o jsonpath='{.status.containerStatuses[0].restartCount}')"
proof_post /__proof/restart >/dev/null
for _ in $(seq 1 60); do
  restart_after="$(kubectl --context "$context" --namespace proof get pod "$broker_pod" -o jsonpath='{.status.containerStatuses[0].restartCount}' 2>/dev/null || echo 0)"
  if (( restart_after > restart_before )); then
    break
  fi
  sleep 2
done
(( restart_after > restart_before ))
kubectl --context "$context" --namespace proof wait pod "$broker_pod" --for=condition=Ready --timeout=2m
dig @"$dns_host" -p "$dns_port" TXT _acme-challenge.replay.z1.proof.test +noall +answer \
  | tee "$evidence_dir/case-d-after.txt"
grep -Fq active-through-restart "$evidence_dir/case-d-after.txt"
dig @"$dns_host" -p "$dns_port" A a.z1.proof.test +short | grep -Fxq 1.2.3.4
dig @"$dns_host" -p "$dns_port" AAAA aaaa.z1.proof.test +short | grep -Fxq 2001:db8::1
dig @"$dns_host" -p "$dns_port" CNAME hostname.z1.proof.test +short | grep -Fxq lb.example.com.

apply_certificate wildcard-z1-replay z1-issuer
kubectl --context "$context" --namespace proof wait certificate wildcard-z1-replay \
  --for=condition=Ready --timeout=4m
kubectl --context "$context" --namespace proof get certificate wildcard-z1-replay -o yaml \
  | tee "$evidence_dir/case-d-certificate.yaml"
kubectl --context "$context" --namespace proof get order -o name | grep -Fq 'wildcard-z1-replay'
case_d_state="$(proof_state)"
python3 -c \
  'import json, sys; state=json.load(sys.stdin); audit=state["audit"]; presented=sum(1 for item in audit if item["event"] == "challenge_presented" and item.get("name") == "_acme-challenge.z1.proof.test"); cleaned=sum(1 for item in audit if item["event"] == "challenge_cleaned" and item.get("name") == "_acme-challenge.z1.proof.test"); replay=next(item for item in reversed(audit) if item["event"] == "desired_state_replayed"); raise SystemExit(0 if state["replayCount"] >= 2 and replay["targetCount"] == 3 and replay["challengeCount"] == 1 and presented >= 2 and cleaned >= 2 else 1)' \
  <<<"$case_d_state"
python3 -m json.tool <<<"$case_d_state" | tee "$evidence_dir/case-d-broker.json"
kubectl --context "$context" --namespace proof logs deployment/pebble \
  | tee "$evidence_dir/case-d-pebble.txt"
(( "$(grep -Fc 'Starting 3 validations.' "$evidence_dir/case-d-pebble.txt")" >= 2 ))
(( "$(grep -Fc 'Issued certificate serial' "$evidence_dir/case-d-pebble.txt")" >= 2 ))

{
  echo 'CASE A PASS: wildcard Certificate Ready=True through broker webhook.'
  echo 'CASE B PASS: cross-allocation challenge and target writes denied; forged Certificate not Ready.'
  echo 'CASE C PASS: A, AAAA, and hostname target types preserved in DNS.'
  echo 'CASE D PASS: desired targets and active challenge replayed; second Order issued.'
} | tee "$evidence_dir/run-summary.txt"
{
  k3d version
  kubectl version --client
  echo "cert-manager images: $cert_manager_images"
  kubectl --context "$context" version
  docker version --format 'Docker server {{.Server.Version}}'
} | tee "$evidence_dir/versions.txt"
