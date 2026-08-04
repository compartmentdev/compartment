# Existing Kubernetes installation prerequisites

This guide prepares an existing Kubernetes cluster for `compartment install`. Compartment does not install, upgrade,
or remove Kubernetes, an Ingress Controller, cert-manager, a CNI, or a StorageClass.

## Supported installation channel

The existing-Kubernetes installer is the supported self-hosted installation channel. The public bootstrap at
`https://compartment.dev/install.sh` serves the root installer approved for the `kubernetes` channel. That installer
resolves the current branch commit and matching immutable CLI OCI artifact by digest, then verifies its Cosign
identity, OIDC issuer, and workflow commit before pulling it. No channel flag or raw branch URL is required.

The supported test matrix uses isolated k3d shards. Every shard owns one cluster and installs its selected
Ingress Controller and pinned cert-manager prerequisite once:

- `managed-install`: managed DNS, TLS, first-owner installation, and retained-stage retry;
- `install-ha-network-policy`: install, HA, and NetworkPolicy enforcement;
- `build-matrix-a-*`: install, Dockerfile and source builds, registry push and node pull, rollout, and image lifecycle;
- `build-matrix-b-*`: two-node ingress-nginx clusters, with the existing Traefik controller left available, plus
  install, Railpack, and static build variants distributed across three partitions;
- `user-flow`: install plus authenticated CLI, organization, project, and domain flows;
- `user-flow-stateful-a`: backup, restore, redeploy, rollback, and staging promotion flows;
- `user-flow-stateful-b`: access control, session invalidation, audit export, and project archive flows;
- `console`: install plus Console, G1 isolation, private-route denial, and product-log gates.

Ingress Controller plus cert-manager setup has a 120-second wall-time budget in every shard. The lifecycle harness
measures and enforces that budget, and the shard owner is the suite named above. A shard reuses the same prerequisite
installation for all of its scenarios.

The supported contract is the current and previous tested Kubernetes minors plus the required capability checks.
CI currently exercises Kubernetes 1.36 and 1.35. Exact k3s builds remain reproducible CI inputs and managed-VM
installation evidence, not a customer-facing compatibility pin.

## Required cluster capabilities

Provide a cluster from the supported minor window, a working kube context, an installed and ready Ingress
Controller with an IngressClass, cert-manager v1.21.0 with its CRDs and controller components ready, a usable
StorageClass, and a CNI that enforces the NetworkPolicy features used by Compartment.

The private registry uses the retained Service IPv4 ClusterIP directly and requires a cert-manager CA Issuer whose CA
is already trusted by every node container runtime. The installer does not configure registry DNS or mutate node
host/runtime files. Public ACME issuers cannot issue the private IP certificate.

For an operator-owned base domain, the installation wizard offers exactly two public TLS modes:

- `external` is the default. Compartment serves `console.<base-domain>` and `*.<base-domain>` over HTTP, and the
  operator terminates TLS outside the platform.
- `existingSecret` references an existing `kubernetes.io/tls` Secret in the release namespace. The Ingress uses that
  Secret and Compartment does not create public Certificates.

In both modes, point `console.<base-domain>` and `*.<base-domain>` at the Ingress endpoint. The private registry still
requires its separate cert-manager CA Issuer because it is addressed through its ClusterIP.

Kube-proxy-based Service routing is required on every node. Kube-proxy-less Cilium is not supported.

The installer checks API reachability and version, required APIs and permissions, release ownership, IngressClass and
StorageClass selection, cert-manager APIs and readiness, Certificate admission by server-side dry-run, Ingress host
ownership, retained installation identity, and published image signatures. These checks do not create namespaces,
Pods, Certificates, Secrets, or other persistent cluster objects.

## Bare-VM test quickstart

Use this sequence only for a clean test VM:

```bash
curl -sfL https://get.k3s.io | sh -
sudo k3s kubectl apply \
  -f https://github.com/cert-manager/cert-manager/releases/download/v1.21.0/cert-manager.yaml
sudo k3s kubectl --namespace cert-manager wait deployment --all \
  --for=condition=Available --timeout=5m
```

For this test VM only, create a private registry CA and a ClusterIssuer backed by it:

```bash
sudo k3s kubectl apply -f - <<'EOF'
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: selfsigned-bootstrap
spec:
  selfSigned: {}
---
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: compartment-registry-ca
  namespace: cert-manager
spec:
  isCA: true
  commonName: compartment-registry-ca
  secretName: compartment-registry-ca
  issuerRef:
    kind: ClusterIssuer
    name: selfsigned-bootstrap
---
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: compartment-registry-ca
spec:
  ca:
    secretName: compartment-registry-ca
EOF
sudo k3s kubectl --namespace cert-manager wait certificate/compartment-registry-ca \
  --for=condition=Ready --timeout=2m
sudo k3s kubectl wait clusterissuer/compartment-registry-ca \
  --for=condition=Ready --timeout=2m
```

Install the generated CA certificate into the operating-system trust store on every k3s node. On the server node:

```bash
sudo k3s kubectl --namespace cert-manager get secret compartment-registry-ca \
  --output 'jsonpath={.data.ca\.crt}' \
  | base64 --decode \
  | sudo tee /usr/local/share/ca-certificates/compartment-registry-ca.crt >/dev/null
sudo update-ca-certificates
sudo systemctl restart k3s
```

For a multi-node test cluster, securely copy `compartment-registry-ca.crt` to the same trust-store path on every other
server and every agent. Run `sudo update-ca-certificates` everywhere, then restart `k3s` on every server and
`k3s-agent` on every agent before installing.
Select `ClusterIssuer/compartment-registry-ca` when the wizard asks for the private registry TLS issuer.

This self-signed bootstrap is a test-only convenience. Production clusters must use an organization-managed CA whose
certificate is distributed and governed through the organization's normal node trust process.

Make the k3s kube context available to the CLI, then run:

```bash
compartment install
```

The default domain choice is a managed Compartment domain. It is allocated directly during installation with no prior
setup when the discovered Ingress endpoint is IPv4 or IPv6. If the Ingress publishes a hostname, use an operator-owned
domain: the production broker publishes only A/AAAA records, and the installer will not resolve a cloud load-balancer
hostname to an unstable IP address.

Default k3s supplies Traefik, ServiceLB, Flannel, its NetworkPolicy controller, CoreDNS, and the `local-path`
StorageClass. The pinned cert-manager manifest supplies the Certificate APIs, controller, webhook, and cainjector.
Compartment does not own their lifecycle.

If preflight reports a missing or unready cert-manager component, repair that component or reapply the pinned
v1.21.0 manifest before retrying. Preflight names the failed component and repeats the pinned command.
