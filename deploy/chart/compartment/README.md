# Compartment Helm chart

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
foundation release, waits for the Caddy LoadBalancer address, allocates a managed domain, persists the installation
identity, domain allocation, and ingress addresses in a retained Kubernetes Secret, and renders the full release with
managed DNS-01 TLS. Source checkouts do not contain an embedded chart; pass `--chart
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

- `service.caddy.type` and the external ingress or load-balancer configuration; the default is a LoadBalancer on
  external ports 80 and 443 with Caddy listening internally on 8080 and 8443;
- `storage.storageClass` and the PVC sizes under `storage`;
- verified digests for the four platform images;
- the values under `secrets`, supplied through the installation's secret-management workflow.

Use `platform.rollbackRetentionLimit` to set the install-wide number of rollback images retained for organizations that
do not set their own policy. Leave it empty, as it is by default, to retain rollback images indefinitely. Authentication
throttles live under `platform.authThrottle.{login,activation,passwordReset}`. Each flow has a `route` window and limit;
login also has `source`, `account`, and `sourceAccount` scopes, while activation and password reset have `source`,
`subject`, and `sourceSubject` scopes. Those scoped controls add a `cooldown`. The values in `values.yaml` preserve the
default protection policy; change them only when your traffic and incident-response requirements justify it.

Managed TLS uses typed `platform.acmeIssuer`, `platform.acmeCaUrl`, `platform.acmeEmail`, and
`platform.managedDomainBrokerUrl` values. The chart owns the ACME issuer and CA defaults; the CLI supplies the owner
email and broker credential. At runtime the token is held by the retained install-state Secret and projected into API
and Caddy with individual Secret references, never a ConfigMap. Helm also stores supplied secret values in its
Kubernetes release revision Secrets, so restrict access to both resource classes. A full public render requires its
base domain, installation ID, ingress address, HTTPS protocol, ACME settings, and external 80/443 ports; the values
schema rejects malformed IP, URL, and email syntax. The CLI also rejects private or reserved ingress addresses. Direct
Helm recovery bypasses that routability check, so the operator must verify that supplied ingress addresses are public.

For an operator-owned base domain, pass `--base-domain`. Set `platform.publicIngressIpv4` or
`platform.publicIngressIpv6` when the Service is not a LoadBalancer. For Caddy-managed custom certificates, create a
Kubernetes TLS Secret containing `tls.crt` and `tls.key`, then set `platform.tlsMode=custom-cert` and
`customTls.existingSecret=<name>`. Set `platform.acmeEmail` as well; Caddy uses it when issuing on-demand certificates
for tenant custom domains that are not covered by the platform certificate. The same Secret is mounted read-only in
API and Caddy. The chart can also create the Secret from `customTls.certificate` and `customTls.privateKey`, but do not
commit private key material to a values file. Inline material is also retained in Helm release revision Secrets;
prefer `customTls.existingSecret`. After rotating an existing Secret in place, change `platform.rolloutMarker` to
restart API and Caddy so Caddy reloads the certificate.

The `<release>-install-state` Secret and registry-auth Service have Helm's `keep` resource policy. An uninstall
followed by reinstall with the same namespace and release name reuses the installation ID, managed-domain allocation,
and registry ClusterIP. Keep the namespace and registry-auth Service during this supported reinstall path. To
intentionally abandon only the install identity, uninstall the release and delete the Secret selected by both
`app.kubernetes.io/instance=<release>` and `app.kubernetes.io/component=install-state` before reinstalling.

The chart's Caddy Service is the only public entrypoint. It never routes `/internal/*`. Point both
`console.<baseDomain>` and `*.<baseDomain>` at that entrypoint.

## System-domain operations

Use the matching CLI for system-domain changes. The CLI stages state through the API deployment's private operator
channel and applies the matching Helm release update:

```bash
compartment system domain status
compartment system domain set --base-domain apps.example.com --tls external
```

Publish every DNS record printed by `set`, including its operation-specific ownership TXT record, and wait for DNS
propagation before continuing:

```bash
compartment system domain verify
compartment system domain activate --values compartment-values.yaml
```

For `custom-cert`, run `attach-cert --cert-file <path> --key-file <path> --values <path>` before verification. The CLI
stores the PEM files in a Kubernetes TLS Secret and mounts the pending operation path in API. Activation mounts the
active certificate in API and Caddy, finalizes the private API operation, and then commits the retained generation.
The first Helm update switches runtime resources while retained install state remains on the previous generation. If
API activation then fails, fix the reported condition and rerun `activate`; the idempotent retry repairs the Helm
release and retained state. Domain generation prevents an older Helm render from replacing the active domain. The
chart keeps the first managed allocation in the same Secret so
`system domain reset-managed --values <path>` can restore it.

`set` and `verify` do not roll workloads. `attach-cert` rolls API to mount pending certificate material; `activate` and
`reset-managed` roll API, Edge, and Caddy. Worker and project-provisioner pods remain running. If Helm or readiness
fails, rerun the command after fixing the cluster condition.

Use `compartment system issue-password-reset --email <email>` to recover an eligible local-password account, including
the owner. The CLI reaches the private
operator channel through `kubectl exec`; the chart does not add a public recovery route. The command prints a
one-time token, so protect terminal output and shell logs.

All system-domain commands and password recovery require access to get the API Deployment, list its Pods, and create
the `pods/exec` subresource. Only `attach-cert`, `activate`, and `reset-managed` also require Helm upgrade permissions
for the chart resources.

## Node registry prerequisite

Application image references use the bundled registry host
`<release-fullname>-registry-auth.<namespace>.svc:5000`. Kubernetes nodes do not resolve Service DNS through cluster
DNS when their container runtime pulls images. Configure every node's container runtime with a mirror or equivalent
route to the bundled registry before deploying applications. This node-level configuration is outside Helm's scope.

The k3d e2e harness configures its k3s `registries.yaml` explicitly; use the corresponding mechanism for your
Kubernetes distribution. If you delete the namespace or retained registry-auth Service, update every node's mirror
with the newly allocated Service IP and restart the container runtime before deploying applications. For k3s, edit
`/etc/rancher/k3s/registries.yaml` and restart k3s.
