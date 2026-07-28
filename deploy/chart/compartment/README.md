# Compartment Helm chart

## Platform TLS

Managed-domain installs create the namespaced Issuer named by
`tls.issuerRef.name` (default `compartment-platform`) and use the bundled
managed-domain DNS-01 webhook. The webhook reads only the allocation-scoped
broker token from the retained install-state Secret; certificate private keys
remain in cert-manager-managed Kubernetes Secrets. Its broker URL, allocation
ID, and token Secret reference are fixed by the Deployment rather than accepted
from Issuer webhook configuration. The registered webhook API group is derived
from the release name and namespace plus `tls.solver.groupName`, keeping release
registrations distinct.

Operator-owned domains never create a ClusterIssuer. Set
`tls.issuerRef.name` and `tls.issuerRef.kind` to an existing `Issuer` or
`ClusterIssuer`, or set `tls.existingSecret` to an existing
`kubernetes.io/tls` Secret. The `tls.issuerRef` surface is also the stable
reference for additional platform Certificates, including the Phase 4
registry-hostname Certificate.

`tls.acme.environment` selects `staging` or `production`; the corresponding
ACME directory URLs are independently configurable for test CAs and the live
staging gate.

## Requirements

- Kubernetes 1.30.0 or newer. The chart uses the stable `admissionregistration.k8s.io/v1`
  `ValidatingAdmissionPolicy` API to confine project-bootstrap authority.
- Helm 4.x.
- Installer credentials that can manage the chart's Namespaces, ClusterRoles, ClusterRoleBinding,
  ValidatingAdmissionPolicy, ValidatingAdmissionPolicyBinding, and namespaced resources.
- One Compartment Helm release per cluster. Project provisioning uses canonical cluster-scoped RBAC names shared with
  tenant RoleBindings and admission policy checks, so a second release would conflict with the first.

The chart declares its Kubernetes compatibility range in `Chart.yaml`; Helm rejects older clusters before rendering.

## Install

The supported owner-bootstrap flow is `compartment install`. Release CLI binaries bundle the matching chart, install
its `foundation` and `full` stages, wait for the public Console endpoint, create the first owner, and save the new CLI
session. Prepare the values file described below, then run:

```bash
compartment install \
  --values compartment-values.yaml
```

The command prompts for the owner email, organization, and password. Without `--base-domain`, it creates the
foundation release, observes the selected Ingress status, allocates a managed domain, persists the installation
identity, domain allocation, ingress class, and typed endpoint in a retained Kubernetes Secret, and renders the full
release. Source checkouts do not contain an embedded chart; pass `--chart
./deploy/chart/compartment` when running a source-built CLI.

Retry the command with the same release coordinates when it stops before confirming owner creation. It resumes a
deployed foundation or full release and preserves the install token. Repair or remove Helm releases in failed,
pending, or uninstalled states before retrying. Once the owner exists, the install endpoint is closed; recover the
local session with `compartment login` instead.

For low-level operator recovery, use the chart from the same source release and set verified
`images.{api,worker,edge,caddy}.digest` values. Direct Helm use bypasses the CLI's signature and signing-identity gate,
so do not supply unverified tags. Set `platform.startupStage=full`; the `foundation` stage exists for the CLI's initial
secret-generating install and for workflows that must populate the bundled registry before starting the platform.

```bash
helm upgrade --install compartment ./deploy/chart/compartment \
  --namespace compartment \
  --create-namespace \
  --values compartment-values.yaml \
  --rollback-on-failure \
  --wait \
  --wait-for-jobs \
  --timeout 15m
```

At minimum, decide and persist these values:

- `ingress.className` plus `ingress.controller.namespace` and `ingress.controller.podSelector` for the
  customer-provided Ingress Controller and, when that controller does not publish status, an explicit
  `ingress.endpoint` typed as `A`, `AAAA`, or `hostname`;
- `storage.storageClass` and the PVC sizes under `storage`;
- verified digests for the four platform images;
- matching digests when overriding any bundled PostgreSQL, registry, BuildKit, kubectl, or Vector repository or tag;
- the values under `secrets`, supplied through the installation's secret-management workflow.

Use `platform.rollbackRetentionLimit` to set the install-wide number of rollback images retained for organizations that
do not set their own policy. Leave it empty, as it is by default, to retain rollback images indefinitely. Authentication
throttles live under `platform.authThrottle.{login,activation,passwordReset}`. Each flow has a `route` window and limit;
login also has `source`, `account`, and `sourceAccount` scopes, while activation and password reset have `source`,
`subject`, and `sourceSubject` scopes. Those scoped controls add a `cooldown`. The values in `values.yaml` preserve the
default protection policy; change them only when your traffic and incident-response requirements justify it.

The retained managed-domain allocation and operation-scoped TLS Secret references remain available during staged
domain changes. API and Caddy never mount those certificates: Caddy has one internal HTTP listener behind the selected
Ingress, and the Ingress layer owns public TLS. Helm stores supplied secret
values in its Kubernetes release revision Secrets, so restrict access to both release Secrets and the retained
install-state Secret.

For an operator-owned base domain, pass `--base-domain`. The chart creates one host-scoped Ingress containing the exact
`console.<baseDomain>` rule and the canonical `*.<baseDomain>` application rule. It never creates a hostless rule,
controller-specific annotation, or default backend. The Caddy Service is always ClusterIP and exposes only its
internal HTTP port. A NetworkPolicy admits that port only from Pods matching the configured controller namespace and
labels; update both controller fields when the selected IngressClass is not the default k3s Traefik installation.

The `<release>-install-state` Secret and registry-auth Service have Helm's `keep` resource policy. An uninstall
followed by reinstall with the same namespace and release name reuses the installation ID, managed-domain allocation,
and registry ClusterIP. Keep the namespace and registry-auth Service during this supported reinstall path. To
intentionally abandon only the install identity, uninstall the release and delete the Secret selected by both
`app.kubernetes.io/instance=<release>` and `app.kubernetes.io/component=install-state` before reinstalling.

The customer Ingress Controller is the public entrypoint. It routes only the two installation host families to Caddy;
Caddy preserves the public control-plane allowlist, sends every application request through Edge authorization, and
never exposes `/internal/*`, health, operator, registry, or BuildKit routes.

## System-domain operations

Use the matching CLI for system-domain changes. The CLI stages state through the API deployment's private operator
channel and applies the matching Helm release update:

```bash
compartment system domain status
compartment system domain set --base-domain apps.example.com --tls external --values compartment-values.yaml
```

Publish every DNS record printed by `set`, including its operation-specific ownership TXT record, and wait for DNS
propagation before continuing:

```bash
compartment system domain verify
compartment system domain activate --values compartment-values.yaml
```

For `custom-cert`, run `attach-cert --cert-file <path> --key-file <path> --values <path>` before verification. The CLI
validates the PEM pair locally and writes an operation-scoped Kubernetes TLS Secret. The private API retains only the
Secret name and public certificate metadata. Activation waits for the Ingress TLS path, finalizes the private API
operation, and then commits the retained generation. Neither API nor Caddy mounts certificate material.
The first Helm update switches runtime resources while retained install state remains on the previous generation. If
API activation then fails, fix the reported condition and rerun `activate`; the idempotent retry repairs the Helm
release and retained state. Domain generation prevents an older Helm render from replacing the active domain. The
chart keeps the first managed allocation in the same Secret so
`system domain reset-managed --values <path>` can restore it.

`set` records the exact Issuer reference from the operator values file, while `verify` does not roll workloads.
`attach-cert` creates only the pending TLS Secret; `activate` and `reset-managed` roll the shared domain generation and
wait for Ingress and Certificate readiness before committing it. Worker and project-provisioner pods remain running.
If Helm or readiness fails, rerun the command after fixing the cluster condition.

Use `compartment system issue-password-reset --email <email>` to recover an eligible local-password account, including
the owner. The CLI reaches the private
operator channel through `kubectl exec`; the chart does not add a public recovery route. The command prints a
one-time token, so protect terminal output and shell logs.

All system-domain commands and password recovery require access to get the API Deployment, list its Pods, and create
the `pods/exec` subresource. Only `attach-cert`, `activate`, and `reset-managed` also require Helm upgrade permissions
for the chart resources.

## Private registry endpoint

Set `registry.hostname` to a name that resolves from every node to the retained registry-auth Service ClusterIP.
Set `registry.issuerRef` to the existing cert-manager Issuer or ClusterIssuer owned by the installation TLS setup.
The chart creates only the Certificate reference; it does not create the issuer or DNS-01 solver.

Node resolvers and upstream corporate DNS must permit the registry zone to return a private ClusterIP A record.
Resolvers with rebinding protection require an explicit zone allowlist. Kube-proxy-less Cilium is unsupported until
its container-runtime host-to-ClusterIP path is reproducibly validated. No container-runtime endpoint configuration
or private CA installation is used.

The registry PVC, credential-signing Secret, and Service carry Helm keep annotations. New deploys and rescheduling are
unavailable while the single-replica registry or its PVC is unavailable; already running Pods continue.

Registry recovery is fix-forward:

1. Stop new builds. Record the retained Service ClusterIP with
   `kubectl -n <namespace> get service <release>-compartment-registry-auth -o jsonpath='{.spec.clusterIP}'`.
2. For a Pod-only failure, delete the registry Pod and wait for its Deployment to become Available. For a volume
   attachment failure, inspect PVC/PV events and fence a lost node before detaching or reattaching the volume.
3. Create an application-consistent snapshot with the storage provider while registry writes are stopped. Restore it
   into a replacement PVC only after preserving the failed volume for rollback.
4. Wait for the registry and registry-auth Deployments. Authenticate through the private hostname and fetch a known
   manifest by its recorded `sha256` digest; a tag-only check is not an integrity check.
5. Confirm the retained Service still has the recorded ClusterIP, then rerun `compartment install` with the same
   context, namespace, release, and values. Installation remains incomplete until its temporary image starts on every
   eligible node. Resume builds only after that gate succeeds.

The disposable k3d E2E uses a local test issuer and adds its CA to k3d node trust. This models a certificate chain to
an already trusted public Web-PKI root; production references the T3-owned issuer with `registry.issuerRef` and never
installs a private CA or changes node container-runtime configuration.
