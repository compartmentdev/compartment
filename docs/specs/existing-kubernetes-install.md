# Existing Kubernetes Installation

Status: implementation plan

Target branch: `kubernetes`

## Purpose

This document defines the first supported installation mode for the new Compartment architecture: install Compartment
into a Kubernetes cluster that is already owned and operated by the customer.

This is the canonical Compartment installation path. A later cluster-provisioning mode may create Kubernetes and its
prerequisites first, but it must finish by calling the same installation application service. It must not introduce a
second chart, a second runtime topology, or a second set of installation contracts.

The final cutover has no Docker production runtime, no legacy networking fallback, and no compatibility path for the
previous dedicated-cluster Caddy architecture.

## Fixed decisions

1. `compartment install` remains the CLI-first product entrypoint.
2. Interactive installation is the default on a TTY. Non-interactive installation uses flags and the same validated
   input contract.
3. The install contract does not contain an `existingCluster` mode discriminator. It installs into one explicitly
   selected Kubernetes context.
4. The customer's existing Ingress Controller owns the public load balancer, ports 80 and 443, and public TLS
   termination.
5. Compartment does not install, delete, disable, or reconfigure the customer's Ingress Controller.
6. Compartment does not require Traefik removal. Traefik, ingress-nginx, and other supported controllers remain in
   front of Compartment.
7. Caddy remains inside the cluster as the internal transport behind the selected Ingress Controller. Edge remains the
   authorization boundary for hosted application traffic.
8. cert-manager is an existing-cluster prerequisite. Compartment does not install or upgrade it in this mode.
9. Compartment manages platform and application certificates through cert-manager resources in the customer cluster.
10. The bundled OCI registry remains part of the installation. The user is not asked for Docker Hub, GHCR, Harbor, or
    another external registry.
11. Registry credentials and pull secrets are created automatically. Credentials are scoped to immutable project
    repositories rather than shared globally across organizations.
12. Every project receives its own Kubernetes namespace. An organization may own multiple project namespaces.
13. NetworkPolicy resources remain mandatory runtime projections, but the installer does not detect the CNI, test
    NetworkPolicy support, or run an enforcement probe.
14. There is no `compartment doctor` command in this scope.
15. Firecracker and Kata Containers are not part of this installation mode. gVisor is not installed or required;
    source builds can use an operator-provided RuntimeClass, and install preflight reports whether that optional
    sandbox is selected or available.
16. The production runtime is Kubernetes only. Docker Engine and Docker Compose production installation paths are
    deleted rather than retained as fallbacks.
17. Dockerfile and OCI image build support remains. `packages/docker` is retained only for BuildKit command shaping
    and image-build concerns still used by the Kubernetes pipeline.
18. Existing preview Kubernetes installations are not migrated. The cutover supports fresh installation only.
19. Existing-cluster implementation and testing may merge incrementally into `kubernetes`. Temporary installation
    breakage and incomplete signed artifacts are accepted because that channel is not currently a supported
    compatibility boundary.
20. The existing-cluster program does not provide a one-command bare-VM installation. Its bare-VM test path installs
    default k3s, installs the pinned cert-manager version separately, and then runs `compartment install`.
21. The later cluster-provisioning program restores the one-command bare-VM flow by installing Kubernetes and every
    prerequisite before invoking the same canonical installer.

## Accepted replacement cost

The new architecture intentionally deletes recently shipped work when that work exists only for the old
dedicated-cluster topology:

- the registry mirror command and node mutation flow;
- the retained registry-auth ClusterIP used only by that mirror topology;
- Caddy-managed ACME, `custom-http`, and `custom-cert` TLS modes;
- dedicated-cluster, host-port, and registry-mirror steps in the current install wizard.

This is an explicit architecture decision, not an accidental regression or unfinished migration. Recent code is not
kept behind flags or compatibility branches solely because it was recently shipped.

The following recent work remains canonical and must not be removed with the obsolete topology:

- NetworkPolicy projections, including tenant isolation and RFC1918 egress restrictions;
- reusable project-scoped `imagePullSecret` projection and provisioning plumbing;
- Dockerfile, Railpack, BuildKit, and OCI image-build behavior still used by Kubernetes.

## User-visible installation contract

### Interactive flow

Running:

```bash
compartment install
```

starts the guided flow:

1. Select a kube context.
2. Confirm the target cluster and API server.
3. Select an IngressClass when the cluster has more than one eligible class.
4. Select the default StorageClass when no unambiguous default exists.
5. Select a managed Compartment base domain or provide an operator-owned base domain.
6. Provide the first owner and organization bootstrap input.
7. Review the target namespace, Helm release, ingress class, domain, and storage selection.
8. Confirm installation.

Namespace and release name use stable defaults and remain advanced overrides. The wizard does not ask for a public IP,
public ports, a registry provider, registry credentials, Caddy configuration, a container runtime, or a sandbox
runtime.

### Non-interactive flow

Automation supplies the same canonical values as flags:

- kube context;
- release namespace;
- Helm release name;
- ingress class;
- StorageClass where required;
- managed-domain selection or operator base domain;
- owner and organization bootstrap values;
- an explicit ingress endpoint only when the selected controller does not publish one in Ingress status.

Missing required input fails at the CLI boundary. There are no silent environment defaults, provider guessing, or
`id | slug | name` selection fallbacks.

### Application boundary

The command remains thin. It validates command input, renders progress, and calls one CLI-owned application service:

```text
installIntoKubernetes(input)
```

The service name describes the action, not a product mode. The later cluster provisioner will produce a kube context
and prerequisite configuration, then call this same service.

## Existing-cluster prerequisites

The operator must provide:

- local `helm` version 4.0.0 or newer and `kubectl` version 1.30.0 or newer on `PATH`, with the `kubectl` client
  compatible with the target Kubernetes server;
- a supported Kubernetes version;
- a working kube context;
- permissions required by the Helm release and project bootstrap model;
- an installed and ready Ingress Controller with an IngressClass;
- installed and ready cert-manager CRDs and controllers;
- a usable StorageClass;
- a CNI that enforces the NetworkPolicy features used by Compartment;
- working cluster DNS and node access to the registries that contain signed Compartment platform images;
- kube-proxy-based Service routing on every node. Kube-proxy-less Cilium is not supported because node-side
  container runtimes cannot reliably reach a registry `ClusterIP` in the proved topology.

The Service-routing requirement remains a recorded prerequisite because the installer does not grade node networking.
Once the retained registry-auth Service exists, the installer uses its allocated ClusterIP directly as the registry
host. No base-domain record, broker allocation, third-party wildcard DNS service, node host alias, or container-runtime
mirror is involved. The registry Certificate carries that address in `spec.ipAddresses`; the selected issuer must
produce a chain already trusted by every node runtime. Reinstalling creates a new Service address, so every install
recomputes the registry host after the foundation stage rather than preserving a previous address.

The installer performs non-persistent preflight checks for:

- required local operator tools and their minimum versions, before collecting interactive or non-interactive install
  input;
- API reachability and Kubernetes version;
- required API resources;
- effective Kubernetes permissions;
- release namespace and cluster-scoped ownership conflicts;
- IngressClass existence and ambiguity;
- the required cert-manager CRDs with `cert-manager.io/v1` served;
- cert-manager controller, webhook, and cainjector readiness;
- successful server-side dry-run admission of a namespaced Certificate, leaving no Certificate or Secret;
- StorageClass existence and ambiguity;
- existing Ingress host collisions;
- existing retained installation identity;
- operator issuer trust hazards that can be inferred from the selected Issuer or ClusterIssuer;
- published Compartment image availability and signature policy.

A self-signed cert-manager issuer is rejected because both the node container runtime and the CLI public HTTPS probe
use their normal trust stores. A CA issuer is allowed with an explicit trust-distribution warning because its
certificate chain may be valid when that CA is installed on every node and the operator machine. Failure to read an
issuer because of RBAC produces the same warning instead of adding an undeclared permission requirement.

The required cert-manager resources are Certificates, CertificateRequests, Issuers, ClusterIssuers, ACME Orders, and
ACME Challenges. Component discovery follows the registered webhook Service and standard application labels; it does
not assume that cert-manager is installed in a hardcoded namespace.

The installer does **not**:

- identify or grade the CNI;
- create temporary connectivity namespaces;
- test NetworkPolicy enforcement;
- install or change a CNI;
- install or change the Ingress Controller;
- install or change cert-manager;
- probe host ports 80 or 443;
- remove Traefik;
- modify kubelet, containerd, CRI-O, k3s, or node files.

The consequence is explicit: Compartment creates the required NetworkPolicy objects, but network isolation depends on
the customer CNI actually enforcing them. Namespace, RBAC, Secret, and storage isolation remain enforced by Kubernetes
independently of that omitted installer check.

### Existing-cluster bare-VM test quickstart

The maintained operator procedure is
[Existing Kubernetes installation prerequisites and bare-VM quickstart](../existing-kubernetes-install.md).

For a clean test VM, the existing-cluster prerequisite sequence is:

```bash
curl -sfL https://get.k3s.io | sh -
sudo k3s kubectl apply \
  -f https://github.com/cert-manager/cert-manager/releases/download/v1.21.0/cert-manager.yaml
```

The operator then makes the k3s kube context available to the CLI and runs:

```bash
compartment install
```

Default k3s supplies Traefik, ServiceLB, Flannel, its NetworkPolicy controller, CoreDNS, and the `local-path`
StorageClass. The separate pinned cert-manager manifest supplies its CRDs, controller, webhook, and cainjector.

This quickstart is only an existing-cluster test and operator prerequisite guide. Compartment does not own, upgrade,
or uninstall k3s or cert-manager in this mode. A missing, incompatible, or unready cert-manager installation stops
preflight with the failed component and the pinned installation instructions.

## Target topology

```text
Internet
   |
   v
Customer load balancer and Ingress Controller
   |  exact Compartment hosts only
   |  public TLS terminates here
   v
Compartment Caddy Service (ClusterIP, internal HTTP)
   |
   +--> Console/API public allowlist
   |
   +--> Edge authorization
            |
            v
      Project Services

BuildKit --> private registry endpoint --> Kubernetes nodes --> project Pods
```

The public load balancer is shared with unrelated customer workloads. Compartment owns host rules, not the address.
No hostless or catch-all Ingress may be created.

## Installation sequence

### Stage 1: collect and validate input

1. Resolve one kube context.
2. Resolve one release namespace and Helm release name.
3. Resolve one IngressClass.
4. Resolve one StorageClass where persistent components require it.
5. Run the non-persistent preflight.
6. Verify all published platform images and resolve them to immutable digests.

No cluster state is changed before this stage succeeds.

### Stage 2: retain installation identity

1. Create or resume the retained installation identity.
2. Persist the installation ID, install token, selected ingress class, and selected storage class.
3. Do not create a second retained identity when retrying the same release.

### Stage 3: install the foundation chart

The foundation stage creates:

- the release namespace and namespaced RBAC;
- retained installation state;
- PostgreSQL and persistent storage;
- the bundled registry and registry storage;
- registry authorization components;
- rootless BuildKit and build storage;
- internal API, Worker, Edge, and Caddy Services needed for dependency discovery;
- the cert-manager Issuer or references required by the selected TLS contract;
- exact or wildcard Compartment Ingress resources required to discover the shared ingress endpoint.

Caddy is a ClusterIP Service with one internal HTTP port. It has no public Service type, HTTPS listener, ACME storage,
or certificate mount.

### Stage 4: allocate managed DNS and issue platform TLS

1. Read all addresses from the Compartment Ingress status.
2. For a managed domain, require an IPv4 or IPv6 endpoint. Reject a hostname endpoint with guidance to use an
   operator-owned domain; never resolve a cloud load-balancer hostname into unstable IP records.
3. If the controller does not publish status, require the explicitly supplied endpoint.
4. Allocate the managed domain with one unauthenticated `POST /v1/managed-domains` containing `installationId`,
   `publicIp`, `requestedLabelSource`, and optional CLI/runtime metadata.
5. Retain the returned `baseDomain` and `acmeDnsToken`.
6. Create the platform Certificate resources. The cert-manager webhook presents and cleans TXT records through
   `PUT` and `DELETE /v1/managed-domains/acme-dns/txt`, sending `{name,value}` with
   `Authorization: Bearer <acmeDnsToken>` and requiring HTTP 204.
7. Wait for `Certificate Ready=True`.
8. Fail without marking the installation ready when DNS or certificate issuance does not converge.

Managed wildcard issuance requires a cert-manager DNS-01 integration with the managed-domain broker. That integration
is a hard implementation dependency. The existing Caddy DNS module is not reused as an implicit second certificate
controller.

For an operator-owned base domain, the install contract references an existing Issuer, ClusterIssuer, or operator TLS
Secret according to the final chart contract. Compartment must not create a customer-wide ClusterIssuer implicitly.
Provided certificate material terminates at the Ingress Controller and is never mounted into Caddy.

### Stage 5: establish the private registry path

The bundled registry has two distinct network paths:

- BuildKit pushes through the authenticated internal endpoint.
- Kubernetes nodes pull through a stable, node-resolvable, TLS-protected endpoint.

The endpoint must satisfy all of these constraints:

- no public Ingress;
- no dedicated public LoadBalancer;
- no external registry account;
- no node runtime mirror configuration;
- no insecure HTTP registry;
- no installer-managed customer-wide CA installation;
- stable across ordinary Helm upgrades;
- reachable by kubelet/containerd on every eligible worker node;
- protected by repository-scoped authentication.

The registry host is the retained cluster-only registry Service IPv4 ClusterIP itself. The Certificate uses an IP SAN
for that address and must be issued by an explicitly configured cert-manager CA Issuer whose CA the operator has
already distributed to every node and the CLI machine. Public ACME issuers cannot issue certificates for private
ClusterIPs. Compartment never installs the CA or mutates node host or container runtime configuration.

This avoids the external DNS dependency and rebinding-policy failures of an address-encoding wildcard DNS name such
as `<dashed-cluster-ip>.sslip.io`. The tradeoffs are that image references contain a non-semantic IP address and the
operator must pre-provision node trust plus a CA issuer, rather than using the managed public ACME issuer. Ordinary
Helm upgrades retain the Service and address; a reinstall allocates a new address and the installer deliberately
derives a new registry identity and Certificate.

The proof must explicitly cover:

- kube-proxy-less Cilium eBPF clusters, where host-to-ClusterIP reachability does not use the conventional kube-proxy
  path;
- every eligible node in a supported multi-node cluster, not only a Pod or the control-plane node.

This is an implementation blocker, not permission to add an external-registry prompt or public-registry fallback. If
the mechanism is not portable, the supported-cluster contract must be narrowed or a new canonical private mechanism
must be approved.

Installation verifies the completed path by:

1. pushing a signed test image through the BuildKit/registry path;
2. creating a temporary Pod whose image reference uses the private registry ClusterIP;
3. waiting for kubelet to pull and start it;
4. deleting the temporary workload;
5. refusing to complete installation if the image cannot be pulled.

This is a registry viability check, not a NetworkPolicy check.

### Stage 6: install the full platform

1. Apply the full chart with immutable platform image digests.
2. Wait for migrations, API, Worker, Edge, Caddy, BuildKit, registry, and supporting controllers.
3. Verify public HTTPS only through the selected IngressClass and exact console host.
4. Call the one-time install API.
5. Create the first owner and organization.
6. Save the authenticated CLI session.
7. Mark the retained installation generation ready.

An interrupted install resumes from retained state. It does not create a second domain, second registry identity, or
parallel Helm ownership path.

## Ingress and Caddy design

### Customer Ingress Controller

The existing controller owns:

- the external load balancer;
- listeners on ports 80 and 443;
- SNI and public TLS;
- ACME HTTP-01 solver routing created by cert-manager;
- forwarding to the Compartment Caddy ClusterIP Service.

The install supports standard Kubernetes Ingress first. Traefik and ingress-nginx form the initial compatibility
matrix. Gateway API support is a later adapter and must not create a second application-domain lifecycle.

### Compartment Ingress resources

Installation-time resources include:

- one exact console host;
- the canonical managed application host family;
- only the required ACME and application paths;
- an explicit `ingressClassName`.

Dynamic application custom domains create exact-host Ingress resources. They never create catch-all rules or route
directly to project Services.

### Caddy and Edge

Caddy remains responsible for transport to the trusted internal destinations selected by Compartment. Edge remains
responsible for hosted application authorization.

The Ingress-to-Caddy contract must:

- accept traffic only from the selected Ingress path;
- sanitize and reconstruct forwarded host, scheme, and client metadata;
- preserve the existing public route allowlist;
- prevent `/internal/*`, health routes, private operator routes, registry, and BuildKit exposure;
- keep direct project Service routing out of public Ingress.

Caddy does not:

- request or renew certificates;
- expose a public Service;
- own DNS;
- store certificate state;
- become a second authorization policy engine.

## Domain and certificate lifecycle

### Managed installation domain

The broker remains authoritative for:

- allocating a broker-owned base domain from an installation identity and public IPv4 or IPv6 address;
- publishing the corresponding A or AAAA records;
- issuing the ACME DNS token used to create and remove DNS-01 TXT records.

The customer cluster remains authoritative for Certificate resources, TLS Secrets, Ingress resources, and private
keys.

### Operator-owned installation domain

System-domain commands keep their product intent but change their runtime effects:

- `set` stages the base domain and required issuer or Secret reference;
- `verify` proves ownership and routing to the selected shared ingress endpoint;
- `attach-cert`, if retained by the final public contract, writes an operation-scoped Kubernetes TLS Secret for
  Ingress consumption rather than a Caddy certificate mount;
- `activate` waits for the new Ingress and TLS path before committing the retained generation;
- `reset-managed` restores the original managed allocation without Caddy TLS state.

The old `custom-http` and Caddy `custom-cert` runtime modes do not survive the cutover.

### Application custom domains

The API persists desired state and lifecycle:

```text
pending -> reconciling -> active
                      \-> failed
active -> deleting -> removed
```

After ownership and routing verification, the Worker reconciles:

- one exact-host Ingress to the central Caddy Service;
- one exact-host Certificate;
- the resulting TLS Secret reference;
- Edge activation only after the certificate is ready.

Removal disables Edge routing first, then deletes the Ingress and Certificate, and completes only after Kubernetes
confirms their absence.

Dynamic object names derive from immutable custom-domain IDs. A domain is globally unique and cannot be claimed by a
second organization or project.

## Bundled registry and image authorization

### Storage and availability

The chart installs one persistent OCI registry for the Compartment installation. The initial implementation may use a
single replica with a PVC, but the operational contract must state:

- new deploys and rescheduling depend on registry availability;
- already running Pods continue while the registry is unavailable;
- registry backup, garbage collection, capacity, recovery, and PVC retention are platform responsibilities;
- uninstall does not silently delete retained image data.

Before this topology is production-ready, the operator guide must include a tested runbook for registry Pod failure,
PVC reattachment, node loss, backup, restore into a replacement PVC, integrity verification, and safe return to
service. The runbook must state which deployment and rescheduling operations remain unavailable during recovery.

### Repository identity

Repository paths derive only from immutable IDs, for example:

```text
projects/<project-id>/deployments/<deployment-id>
```

Organization, project, environment, and application display names never form authorization keys.

### Credentials

Project provisioning creates:

- a project-scoped BuildKit push identity;
- a project-scoped kubelet pull identity;
- one namespaced `imagePullSecret`;
- the ServiceAccount reference required for projected application Pods.

The pull Secret is not mounted into application containers. Application ServiceAccounts have no permission to read
Secrets or access the Kubernetes API.

The registry authorization service must reject:

- reads outside the credential's project repository prefix;
- writes from pull-only credentials;
- writes outside the active build intent;
- anonymous reads or writes;
- mutable-name or organization-name fallback matching.

The current installation-wide reader and writer credentials are deleted.

## Organization and project isolation

### Trust model

Compartment protects organizations from:

- another organization's product users;
- another organization's application processes;
- accidental cross-project routing;
- accidental cross-project Secret, storage, registry, or API access;
- ordinary application compromise within the Kubernetes container boundary.

The model does not protect against:

- the customer cluster administrator;
- a Kubernetes control-plane compromise;
- a node kernel or container runtime escape;
- a compromise of the trusted Compartment control plane.

Firecracker, Kata, dedicated nodes, and per-organization clusters are deferred. An operator-selected gVisor
RuntimeClass can strengthen source-build isolation, but it is not installed, required, or silently promised by
namespace isolation.

### API and database boundary

- Every organization-owned query and mutation requires explicit organization context.
- Projects carry immutable organization ownership.
- Cross-organization project, deployment, resource, domain, variable, and audit lookups fail closed.
- Domain and canonical-host uniqueness is enforced durably.
- Registry repository authorization uses immutable project ownership.
- No Kubernetes namespace lookup substitutes for API authorization.

### Kubernetes boundary

Each project receives:

- one immutable-ID namespace;
- dedicated ServiceAccounts;
- no automatic ServiceAccount token mount for application Pods;
- project-local Secrets;
- project-local PVCs and Services;
- default-deny ingress and egress NetworkPolicies;
- explicit application, resource, DNS, ingress, registry, and required platform allowances;
- Pod Security restrictions;
- CPU, memory, storage, and object-count quotas where supported by the product contract.

Application workloads cannot use:

- privileged containers;
- host networking;
- host PID or IPC namespaces;
- hostPath volumes;
- arbitrary ServiceAccounts;
- arbitrary RuntimeClass values;
- direct Kubernetes API credentials.

The project provisioner keeps its existing target-bound bootstrap authority and fail-closed admission guard. No
production or seeded Compartment user, group, or role receives Kubernetes permissions by default.

### Shared trusted components

API, Worker, Edge, Caddy, registry authorization, BuildKit, and the project provisioner are shared installation
components. Their permissions remain minimal and explicit:

- Helm owns installation-time objects.
- API owns desired state and database transactions.
- Worker owns asynchronous orchestration.
- `@compartment/kube-runtime` is the only runtime package that writes dynamic Kubernetes objects.
- Edge owns hosted application authorization.
- Caddy owns transport only.
- BuildKit can push only through build-scoped registry authorization.

## Ownership by package and layer

### `packages/cli`

Owns:

- interactive and non-interactive install UX;
- kube-context, ingress-class, storage, and domain selection;
- non-persistent prerequisite preflight;
- staged Helm orchestration;
- image trust verification;
- typed ingress endpoint observation;
- managed-domain IP allocation and acme-dns token retention;
- TLS and registry readiness waits;
- first-owner bootstrap;
- retained install retry behavior.

It must not own Kubernetes manifests, modify nodes, install cluster prerequisites, or introduce an installer-only
backend API.

### `deploy/chart/compartment`

Owns installation-time Kubernetes objects:

- platform namespace resources;
- Services, Deployments, Jobs, Secrets, ConfigMaps, PVCs, and RBAC;
- Caddy ClusterIP;
- installation Ingress and Certificate resources;
- registry, registry authorization, and BuildKit;
- retained installation state;
- NetworkPolicies and Pod Security labels.

The chart must not own dynamic project workloads or dynamic custom-domain lifecycle objects.

### `packages/contracts` and `packages/sdk`

Own:

- the managed-domain allocation request and response used by the production broker;
- explicit installation and certificate status DTOs where public contracts require them;
- internal custom-domain reconciliation contracts;
- registry authorization contracts only when they cross a process boundary.

No browser-only, CLI-only duplicate, or anonymous object contract is added.

### `packages/api`

Owns:

- organization-scoped desired state;
- project ownership and lifecycle;
- custom-domain persistence, verification, collision checks, and lifecycle state;
- registry repository authorization state;
- durable reconciliation intents;
- first-owner bootstrap.

It does not write Kubernetes objects directly.

### `packages/worker`

Owns:

- build orchestration;
- project provisioning orchestration;
- deployment and resource reconciliation orchestration;
- dynamic domain and Certificate reconciliation orchestration;
- registry credential lifecycle orchestration.

### `packages/kube-runtime`

Owns:

- pure project, application, resource, Secret, Ingress, Certificate, and NetworkPolicy projections;
- server-side apply, exact read, observation, and deletion through existing runtime primitives;
- immutable Kubernetes naming;
- no new parallel Kubernetes client.

### `packages/edge` and Caddy image/configuration

Edge owns the existing hosted application authorization model. Caddy configuration changes to one internal HTTP
transport profile and keeps the explicit route allowlist.

### Managed-domain broker

The client uses the production broker contract without extending it:

1. allocate the domain with one unauthenticated `POST /v1/managed-domains` containing `installationId`, `publicIp`,
   `requestedLabelSource`, and optional client metadata;
2. create DNS-01 records with `PUT /v1/managed-domains/acme-dns/txt`;
3. remove DNS-01 records with `DELETE /v1/managed-domains/acme-dns/txt`.

The TXT requests contain `name` and `value`, authenticate with the allocation response's `acmeDnsToken`, and succeed
with an empty `204` response. The broker publishes only A or AAAA records for `publicIp`; a hostname ingress endpoint
is therefore not eligible for a managed domain.

The broker never receives certificate private keys.

## Implementation phases

These phases may merge incrementally and directly into `kubernetes`. Intermediate commits, signed artifacts, and
installation flows may be broken while the architecture is being replaced. The current publication channel is not a
release or compatibility gate for this work.

This permission to break intermediate installation behavior does not permit compatibility flags, fallback paths, or
two permanent architectures. Phase 8 still exits with one canonical installation path and the complete removal
inventory applied.

Every merged phase must pass its scoped lint, typecheck, and test gates even when the end-to-end installation is
temporarily incomplete. Its PR records the entry gate, exit gate, exact tests, exact deletions, and recovery or
fix-forward procedure. Product rollback compatibility is not required for this unused intermediate channel.

### Phase 0: prove hard dependencies

- Prove the private node-pull registry endpoint on k3s/Traefik and ingress-nginx test clusters.
- Prove the same endpoint shape on the initially supported managed-cluster network model.
- Prove direct IPv4 ClusterIP node-pull behavior with a pre-distributed CA trust anchor.
- Prove host-to-ClusterIP node pulls on a kube-proxy-less Cilium eBPF cluster.
- Prove cert-manager DNS-01 through the managed-domain broker.
- Confirm IPv4 and IPv6 allocation behavior and early managed-domain rejection for hostname ingress endpoints.
- Stop implementation if either registry reachability or broker DNS-01 has no canonical solution.
- Do not delete the current registry mirror or registry-auth topology until the replacement proof is recorded.

### Phase 1: replace the install input and wizard

- Introduce the canonical Kubernetes install input without an `existingCluster` mode.
- Make interactive context, ingress, storage, and domain selection the default TTY path.
- Keep non-interactive flags on the same input.
- Replace dedicated-cluster and k3s assumptions in preflight.
- Add cert-manager CRD/API discovery, component readiness, and non-persistent Certificate dry-run checks.
- Add the pinned k3s plus cert-manager existing-cluster test quickstart.
- Add exact host and release ownership collision checks.
- Keep preflight non-persistent and never install or upgrade customer prerequisites.

### Phase 2: cut Caddy behind shared Ingress

- Make the Caddy Service unconditionally ClusterIP.
- Remove its HTTPS port and public Service options.
- Add exact installation Ingress resources using `ingressClassName`.
- Add internal HTTP-only Caddy configuration.
- Preserve public path allowlists and Edge authorization.
- Persist typed ingress endpoint state.

### Phase 3: move managed DNS-01 and TLS to cert-manager

- Keep the production single-request managed-domain allocation contract.
- Pass the resolved IPv4 or IPv6 ingress endpoint as `publicIp` and reject hostname endpoints before heavy install
  phases.
- Add the cert-manager DNS-01 broker integration.
- Move platform TLS to Certificate and Ingress Secret references.
- Rewrite system-domain activation around Ingress and Certificate readiness.
- Make retention or deletion of `system domain attach-cert` an explicit phase entry gate. Phase 3 cannot complete until
  the surviving command, contract, tests, and Ingress TLS Secret ownership are final.
- Remove Caddy certificate state.

### Phase 4: replace the registry mirror with the private node-pull path

- Implement the proven private registry endpoint.
- Replace installation-wide credentials with project-scoped repository authorization.
- Create automatic push and pull credentials during project provisioning.
- Project `imagePullSecrets` through `kube-runtime`.
- Add registry push/pull installation acceptance.
- Delete node mirror configuration and the systemctl-driven k3s restart flow.

### Phase 5: complete project and organization isolation

- Audit every organization-owned API query and command for explicit context.
- Complete project namespace, ServiceAccount, Secret, PVC, quota, and NetworkPolicy projections.
- Enforce restricted application Pod specifications.
- Add cross-organization negative integration coverage.
- Keep NetworkPolicy enforcement tests in CI, but add no install-time CNI check.

### Phase 6: move dynamic domains to durable Kubernetes reconciliation

- Add durable custom-domain reconcile state.
- Add internal claim, observe, complete, and failure contracts.
- Add Worker controller ownership.
- Add pure Ingress and Certificate projections.
- Activate Edge only after Certificate readiness.
- Implement deletion settlement.

### Phase 7: final removal

- Delete every item in the removal inventory.
- Delete dead exports, environment variables, chart values, scripts, fixtures, and generated docs.
- Regenerate reference docs from the surviving CLI contract.
- Run runtime-surface and duplicate checks.
- Do not merge compatibility shims.

### Phase 8: end-to-end acceptance

- Run the complete cluster, ingress, DNS, TLS, registry, domain, isolation, retry, and operator matrix.
- Measure the ingress-controller and cert-manager setup cost in every k3d shard.
- Keep additional prerequisite setup within two minutes of wall time per affected shard, reuse one prerequisite
  installation per cluster, and rebalance the E2E shard allocation when that budget is exceeded.
- Record the final shard count, wall-time budget, and owner of each expensive cluster scenario.
- Point `https://compartment.dev/k/install.sh` at a website-owned 307 redirect to the Kubernetes branch's root
  `install.sh`, and verify the public handoff without requiring users to use a raw-branch URL, hidden channel flag, or
  separate bootstrap instructions.
- Verify concise descriptor validation output for both supported descriptor files.
- Update engineering and public documentation.
- Declare the channel supported only after the old architecture is absent from code, docs, release artifacts, and
  tests.

## Change inventory

This inventory is mandatory implementation scope. Each implementation PR must mark the rows it owns and repeat its
exact delete list.

### Root, release, and CI

- Update release packaging so the bundled chart contains the new shared-ingress resources and values schema.
- Update install bootstrap arguments and generated CLI reference.
- Update final-architecture checks to reject deleted Caddy, mirror, Docker-runtime, and fallback surfaces.
- Update image publication only where registry-auth or Caddy image contents change.
- Update k3d and cluster e2e workflows for an existing Ingress Controller and cert-manager.
- Rebalance the E2E shard allocation and record the prerequisite setup wall-time budget.
- Update `https://compartment.dev/k/install.sh` to redirect with HTTP 307 to the Kubernetes branch's root `install.sh`
  when the channel is declared supported. Do not copy or synchronize the installer into the website repository.

### CLI

- Rewrite install command input, wizard, validation, result, URL, values, and progress output.
- Rewrite Kubernetes install orchestration, foundation, ingress observation, retained state, and release values.
- Keep managed-domain orchestration on the production broker's single IP allocation contract.
- Rewrite system-domain release and lifecycle services around Ingress and Certificate state.
- Add registry endpoint and kubelet pull readiness orchestration.
- Format descriptor schema failures at the canonical CLI parsing boundary. Both `compartment.yml` and
  `compartment.routes.yml` errors must show the filename, normalized field path, and human-readable message without
  exposing Zod issue JSON, a `ZodError` label, or a stack trace.
- Update command tests, install harnesses, fixtures, and generated command docs.

### Contracts and SDK

- Keep `publicIp` in the managed-domain allocation contract and reject hostname endpoints for managed installs.
- Add dynamic custom-domain reconcile contracts.
- Add TLS readiness and failure state to the applicable public domain contracts.
- Add registry authorization process contracts only where a real process boundary requires them.
- Update SDK consumers and contract tests together.

### API and database

- Extend custom-domain persistence with desired generation and reconciliation lifecycle state.
- Add adjacent queries for claim, completion, failure, deletion, and observed state.
- Add explicit organization ownership checks to all affected operations.
- Add immutable project repository authorization state if it cannot be derived safely.
- Update migrations, DB tests, API integration tests, and audit events.

### Worker

- Add custom-domain reconciliation to the existing controller host.
- Add registry credential and repository authorization orchestration to project provisioning.
- Update build scheduling to use project-scoped push authorization.
- Update workload handoff to use the node-reachable registry reference.
- Update controller, build, project provisioning, and recovery tests.

### Kubernetes runtime

- Add pure Ingress and Certificate projections.
- Extend project provisioning with project-scoped imagePullSecrets and ServiceAccount references.
- Keep existing namespace, RBAC, NetworkPolicy, workload, resource, and Secret projections canonical.
- Add exact deletion and observation coverage for domain resources.
- Preserve the existing seven transport primitives.

### Edge and Caddy

- Replace the TLS-mode Caddy configurations with one internal HTTP configuration.
- Update trusted proxy and forwarded-header handling for the selected Ingress path.
- Preserve console/app route allowlists and internal route denial.
- Update Caddy and Edge tests for shared ingress and certificate-independent operation.

### Helm chart

- Add shared-ingress values, schema, templates, and render tests.
- Add cert-manager Issuer/Certificate ownership or explicit references.
- Change Caddy to ClusterIP/internal HTTP.
- Add the private registry endpoint and repository-scoped authorization configuration.
- Update RBAC for dynamic Ingress, Certificate, Secret, and project credential operations.
- Make permission rollout fresh-install-only; no product principal receives the new Kubernetes permissions.
- Update retained installation state for ingress class, typed targets, TLS identity, and registry identity.
- Update chart README and operator assertions.

### Managed-domain broker

- Keep the existing single `POST /v1/managed-domains` allocation with `publicIp`.
- Use the existing ACME DNS token endpoints for cert-manager TXT record creation and deletion.
- Reject hostname ingress endpoints in the client because the broker publishes only A and AAAA records.
- Update the managed-install test broker and contract fixtures.

### Documentation

- Add an interim existing-cluster quickstart for default k3s, pinned cert-manager, kube-context setup, and
  `compartment install`.
- Rewrite:
  - `docs/specs/self-hosted-install.md`;
  - `docs/specs/managed-platform-domains.md`;
  - `docs/specs/app-custom-domains.md`;
  - `docs/specs/k8s-runtime.md`;
  - `docs/specs/system-architecture.md`;
  - affected layer documents;
  - chart README.
- Add the single-replica registry and PVC backup, node-loss, restore, verification, and service-recovery runbook.
- Update public installation, project URL, custom-domain, system-domain, and other operator recovery guides.
- Regenerate CLI references only from the final command surface.

### Acceptance and security tests

- Add shared-ingress coexistence tests.
- Add managed DNS tests for IPv4 and IPv6 endpoints and early hostname-endpoint rejection.
- Add Certificate readiness and failure tests.
- Add registry push, node pull, authorization, retention, and recovery tests.
- Add cross-organization API, routing, network, Secret, storage, and image negative tests.
- Keep NetworkPolicy behavior tests in CI without moving them into installation.
- Add retry tests for every retained installation stage.
- Add focused descriptor-error tests for invalid top-level fields, nested and array-index paths, multiple issues, both
  descriptor filenames, and the absence of raw Zod or stack output.
- Preserve existing non-Zod file-read and YAML parse error behavior in those tests.

## Removal inventory

The final cutover deletes these surfaces. None may remain as a hidden fallback, deprecated mode, undocumented flag, or
test-only production export.

### Dedicated public Caddy

- Caddy `LoadBalancer` and `NodePort` Service modes.
- Caddy public ports 80 and 443.
- Caddy HTTPS listener and `ports.https`.
- Caddy public ingress address discovery from its Service.
- Caddy ACME, on-demand TLS, DNS challenge, and certificate renewal.
- Caddy certificate and ACME data PVC.
- Caddy certificate mounts and custom TLS Secret ownership.
- managed, `custom-http`, and Caddy `custom-cert` runtime configurations.
- broker DNS credentials in the Caddy Pod.
- instructions that position Caddy in front of the entire customer cluster.

### Traefik, host-port, and dedicated-cluster assumptions

- k3s `--disable traefik` guidance.
- automatic Traefik deletion or disablement.
- checks that require ports 80 and 443 to be free.
- klipper-lb conflict handling tied to Compartment's own LoadBalancer.
- assumptions that the cluster exists only for Compartment.
- ingress detection by hardcoded controller namespace.
- controller-specific annotations in shared generic templates.
- hostless and catch-all ingress rules.

### Registry mirror and node mutation

- `compartment system registry-mirror`.
- registry mirror command output and generated docs.
- install-time mirror questions and instructions.
- `--skip-registry-mirror`.
- k3s registry YAML merge and validation.
- writes under `/etc/rancher/k3s`.
- `systemctl`-driven k3s restart.
- local-node detection and multi-node copy/paste commands.
- retained registry-auth ClusterIP whose only purpose is preserving node mirror configuration.
- insecure registry and private-CA node configuration paths.
- any external/BYO registry prompt or fallback.

### Global registry credentials

- installation-wide registry reader username and password.
- installation-wide registry writer username and password.
- one shared pull credential copied to every project.
- registry authorization that ignores repository scope.
- mutable display names in registry paths or authorization.

### Legacy TLS modes

- `platform.tlsMode` values that describe where Caddy terminates TLS.
- `custom-http` as a Compartment runtime topology.
- `custom-cert` as a Caddy mount topology.
- Caddy-specific fields in domain host plans and retained state.
- DNS verification treated as equivalent to Certificate readiness.
- direct certificate file mounts into API or Caddy when a Kubernetes TLS Secret reference is sufficient.

The public `system domain attach-cert` command is not automatically deleted. Phase 3 begins by choosing exactly one
outcome. If retained, its implementation produces an Ingress-consumed TLS Secret; if deleted, its command, contract,
tests, and documentation are removed in that phase. Phase 3 cannot complete with the choice unresolved.

### Superseded managed-domain allocation model

- reservation, target-binding, challenge, and replay endpoints;
- allocation IDs and scoped tokens in retained state;
- one-time resolution of a load-balancer hostname into permanent A records;
- claims that the production broker accepts or tracks hostname targets.

The surviving production contract intentionally requires `publicIp`. Retained ingress state may describe hostname
endpoints for operator-owned domains, but managed-domain installation rejects them rather than resolving them.

### Install-time NetworkPolicy checks

- any planned CNI capability detector.
- any install-time temporary NetworkPolicy test namespaces or Pods.
- any installation failure based on an active NetworkPolicy enforcement probe.
- any `compartment doctor` command or network-policy diagnostic surface.

NetworkPolicy manifests and CI enforcement tests are retained.

### Sandbox runtimes

- Firecracker integration.
- gVisor installation, node mutation, or automatic RuntimeClass selection.
- install failure solely because no gVisor RuntimeClass is available.
- Kata Containers installation or detection.
- a separate RuntimeClass selector in the public install contract; operators configure the chart value.
- a security claim that Kubernetes namespaces provide VM-level isolation.

### Docker production runtime

- Docker Engine installation or minimum-version checks for production install.
- Docker Compose production manifests and orchestration.
- host node-agent installation, systemd units, and Unix-socket runtime control.
- host runtime directories, ownership repair, and sudo rerun paths.
- Docker bridge, subnet, iptables, nftables, and host-port management.
- local Docker image production install mode.
- Docker Hub/GHCR runtime selector for tenant-built images.
- Docker container, volume, and network identity in product contracts.
- Docker-specific system commands, SDK methods, fixtures, and documentation.
- migration or runtime fallback to the Docker architecture.

`packages/docker` is not deleted wholesale. BuildKit invocation, Dockerfile build semantics, Railpack integration, OCI
references, and image metadata remain when they have live Kubernetes callers.

### Parallel and compatibility paths

- an `existingCluster` API mode discriminator.
- a separate installer for the later provisioned-cluster mode.
- direct Helm as a documented equivalent to the verified CLI installation path.
- permanent old/new chart values aliases.
- old retained-state interpretation after the clean-install cutover.
- migration of preview Kubernetes Caddy-LoadBalancer installations.
- Gateway API as a simultaneous second implementation in Implementation Phase 1.
- API-side Kubernetes writes.
- Helm ownership of dynamic project or custom-domain resources.
- direct public Ingress to tenant Services.
- raw-branch installer URLs or a hidden `--channel kubernetes` requirement in the supported public bootstrap.

### Obsolete docs and tests

- dedicated k3s node setup instructions.
- Traefik removal instructions.
- Caddy public TLS and ACME documentation.
- node registry mirror operator instructions.
- external/BYO registry setup instructions.
- Docker production runtime and update guides.
- generated reference for deleted commands and flags.
- tests and fixtures that protect only removed plumbing.
- legacy architecture assertions in chart, release, smoke, and public-doc tests.

The new existing-cluster k3s plus cert-manager test quickstart is not removed with the old dedicated-k3s instructions.
It documents prerequisites for the canonical existing-cluster installer and does not restore Compartment ownership
of the cluster lifecycle.

## Acceptance criteria

### Installation and coexistence

- `compartment install` succeeds interactively against a supported existing cluster.
- Non-interactive installation uses the same contract.
- Existing Traefik remains installed and serving unrelated workloads.
- ingress-nginx remains installed and serving unrelated workloads.
- Compartment creates no dedicated public LoadBalancer.
- Compartment creates no catch-all Ingress.
- Host collision fails before mutation.
- Missing cert-manager CRDs fail preflight with pinned installation guidance.
- Unready cert-manager controller, webhook, or cainjector fails preflight with the exact component.
- Certificate dry-run failure stops installation without leaving a Certificate or Secret.
- An interrupted install resumes one retained identity.

### Public bootstrap

- `https://compartment.dev/k/install.sh` redirects with HTTP 307 to the root `install.sh` on the Kubernetes branch
  when the channel is declared supported; that branch file remains the sole source of truth.
- The bootstrap resolves and verifies the signed release artifact.
- A user does not need a raw GitHub branch URL, `--channel kubernetes`, or undocumented bootstrap path.
- The public bootstrap followed by `compartment install` completes the supported existing-cluster flow.

### CLI error presentation

- Invalid `compartment.yml` and `compartment.routes.yml` schema errors identify the filename and every failing
  normalized field path with concise human-readable messages.
- Nested fields and array elements are rendered as readable paths.
- Multiple validation issues remain readable and deterministic.
- CLI stderr contains no `ZodError` label, serialized Zod issue objects, or stack trace.
- Non-Zod file-read and YAML syntax errors retain their existing specific diagnostics.

### DNS and TLS

- Managed installation supports IPv4 and IPv6 ingress endpoints; hostname endpoints fail early with
  operator-owned-domain guidance.
- Console and default application hosts resolve to the shared ingress endpoint.
- Platform Certificate readiness gates successful installation.
- Custom-domain readiness gates Edge activation.
- Certificate failure is durable and visible.
- Private keys remain in the customer cluster.
- `/internal/*`, health, operator, registry, and BuildKit paths are not public.

### Registry and builds

- The user supplies no external registry account or credentials.
- BuildKit pushes with project-scoped authorization.
- Kubernetes nodes pull through the private, trusted endpoint without runtime mirror changes.
- A project credential cannot pull or push another project's repositories.
- Application containers cannot read their kubelet pull Secret.
- Registry restart and retained PVC recovery preserve image availability.
- The tested operator runbook restores registry service after Pod, PVC attachment, and node-loss failures.
- Garbage collection cannot delete images still retained by deployment history.

### Organization isolation

- Two organizations cannot read or mutate each other's projects through API, SDK, CLI, or Console.
- One project's Pod cannot reach another project's private Service under the enforced test CNI.
- One project's application cannot read another namespace's Secrets or PVCs.
- One project's deployment cannot select another project's image.
- A custom domain cannot be claimed by two route owners.
- No product principal receives Kubernetes permissions.
- Cluster-administrator and container-escape limitations are documented without overstating isolation.

### Cutover completeness

- The complete removal inventory is absent from runtime code, release artifacts, chart values, CLI help, generated
  reference, internal docs, public docs, and tests.
- Runtime entrypoints have no Docker production fallback.
- Caddy has one internal HTTP configuration.
- There is one Kubernetes installation application service.
- The later cluster-provisioning work can call that service without changing its contract.

## Validation matrix

### Package checks

Run the narrow lint, typecheck, and test commands for every changed owning package:

- CLI;
- contracts;
- SDK;
- API;
- Worker;
- kube-runtime;
- Edge;
- Docker build adapter when its live surface changes.

Run DB-backed tests for custom-domain, organization-ownership, registry-authorization, or schema changes. Run chart
schema, render, and ownership tests for every values or template change.

### End-to-end clusters

At minimum:

- k3s with default Traefik left installed;
- a cluster using ingress-nginx;
- a topology whose Ingress status returns an IP;
- a topology whose Ingress status returns a hostname;
- a supported multi-node topology for the registry node-pull proof;
- a kube-proxy-less Cilium eBPF cluster.

### End-to-end scenarios

- managed install and first owner;
- operator-owned base domain;
- existing unrelated Ingress hosts;
- platform TLS issuance and renewal;
- managed default application host;
- custom domain ownership, certificate readiness, activation, and deletion;
- build, push, node pull, rollout, promote, rollback, and retained-image cleanup;
- two-organization isolation matrix;
- install retry after every retained stage;
- system-domain set, verify, activate, and reset-managed;
- public-route denial for every private surface;
- upgrade of the new architecture after its first release.

## Future cluster-provisioning mode

The later mode performs only prerequisite provisioning:

```text
provision Kubernetes
-> install and configure CNI
-> install Ingress Controller
-> install cert-manager
-> install StorageClass
-> produce kube context
-> call installIntoKubernetes(input)
```

That mode is the one-command bare-VM experience. It installs and pins every listed prerequisite before invoking the
canonical installer; the user does not prepare ingress, cert-manager, storage, or CNI manually.

It may make stronger decisions because Compartment owns the created cluster, including a supported CNI or sandbox
runtime. Those decisions do not enter the existing-cluster install contract unless they become universal requirements.

The provisioner must not fork:

- chart values ownership;
- domain allocation;
- registry authorization;
- project provisioning;
- application reconciliation;
- domain reconciliation;
- first-owner bootstrap;
- retained install state.

## Hard blockers

Implementation does not begin beyond focused proofs until these are resolved:

1. A portable, private, TLS-protected, node-reachable bundled-registry endpoint must work without external registry
   credentials or node runtime modification.
2. cert-manager must complete managed wildcard DNS-01 through the broker with the allocation's ACME DNS token.
3. Managed-domain installation must reject hostname ingress endpoints before heavy phases and direct the operator to
   `--base-domain`; it must never freeze a cloud load-balancer hostname to a resolved IP.
4. The exact supported Ingress Controller, Kubernetes, and cert-manager version matrix must be published.

NetworkPolicy enforcement detection is intentionally not a blocker because it is explicitly excluded from installer
scope. Its absence and security consequence remain documented prerequisites.
