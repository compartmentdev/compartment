# Self-Hosted Kubernetes Install

This document defines the supported production install and operator contract for a self-hosted Compartment release.
Kubernetes is the only production runtime. The release CLI owns install orchestration and image verification; the Helm
chart owns installation-time Kubernetes resources.

For a fresh dedicated k3s node, disable its default Traefik ingress during installation so Compartment's Caddy
LoadBalancer can use ports 80 and 443:

```bash
curl -sfL https://get.k3s.io | sh -s - --disable traefik
```

Only the default `kube-system/traefik` should receive the disable/remove guidance. If another Service owns the ports,
do not remove it: free 80 and 443 on a dedicated cluster. A shared-cluster topology requires
`service.caddy.type=ClusterIP` or `NodePort`, an explicit `platform.publicIngressIpv4` or
`platform.publicIngressIpv6`, and routing through the existing ingress. The guided installer does not automate this
mode yet and its klipper preflight still stops at the conflict.

## Install modes

`compartment install` is the guided production entrypoint. `compartment install --values <path>` is the declarative
entrypoint for CI and advanced operator configuration. Both use the bundled matching chart, verify the effective API,
Worker, Edge, and Caddy images against the published signing policy, resolve them to immutable digests, and apply two
Helm stages:

1. `foundation` creates the public Caddy Service, generated install secrets, storage, and the retained install-state
   Secret. PostgreSQL and the registry start here; API, Worker, Edge, Caddy, and the remaining platform workloads wait
   for `full`.
2. The CLI resolves the public ingress and install domain, persists that state, and applies `full`. It then waits for
   HTTPS, calls the one-time `/v1/install` boundary, creates the first owner, and saves the owner session.
3. The CLI reads the actual retained registry-auth Service name and ClusterIP and configures the required local k3s
   registry mirror before the first application deploy when it can do so safely. The apply command uses the CLI's
   YAML-aware merge, atomically writes the node config, and restarts k3s. The chart cannot mutate node-level
   container-runtime configuration.

For an unambiguous `KUBECONFIG=/etc/rancher/k3s/k3s.yaml` on the local node, a root CLI process with write access to
`/etc/rancher/k3s` and an available `systemctl` can apply the mirror. Interactive installs ask one short `Y/n`
question before printing any multi-node instructions; non-interactive installs apply automatically unless
`--skip-registry-mirror` is set. The merge changes only the installed registry host entry and preserves other mirrors.
The CLI restarts k3s and verifies that the written endpoint contains the Service's current ClusterIP. It prints compact
numbered instructions when the operator declines, automatic local setup is unavailable, or the cluster has additional
nodes, and after a local apply or verification failure. Every other k3s node must have the same CLI version available
and run the rendered apply command separately.

The default mode is a managed domain. When `--base-domain` is omitted, the CLI waits for a public LoadBalancer address,
requests an allocation from `https://broker.compartment.run`, and configures managed DNS-01 TLS. The broker credential
is scoped to that allocation. API and Caddy read it from the retained Secret; it is never stored in a ConfigMap.

An operator-owned base domain is selected with `--base-domain`. The operator must point `console.<baseDomain>` and
`*.<baseDomain>` at the public entrypoint and choose one TLS topology in the values file:

- `custom-cert`: Caddy terminates TLS with an existing Kubernetes TLS Secret. The Secret is mounted read-only in API
  and Caddy. `platform.acmeEmail` remains required for on-demand tenant-domain certificates.
- `custom-http`: an external load balancer terminates public HTTPS and reaches the Caddy HTTP origin. The operator owns
  that load-balancer topology and must provide the explicit public ingress address.

The reserved `*.localhost` HTTP path exists only for repository and k3d development. It is not a production install
mode. `install --dev` initializes an already-running repository development API and does not install the Helm release.

Direct `helm upgrade --install` is a low-level recovery path, not the normal install. It bypasses CLI image signature
verification, so an operator using it must supply already verified `images.*.digest` values.

## Install identity and retries

The `<release>-install-state` Secret retains the installation ID, install token, domain allocation, ingress addresses,
domain generation, and TLS identity. Helm keeps it and the registry-auth Service across upgrades and
uninstall/reinstall with the same namespace and release name. Retaining the Service preserves its ClusterIP and keeps
node-level registry mirrors valid. A retry with the same release coordinates and domain selection resumes the saved
foundation or full release and does not allocate a second managed domain. The supported reinstall path keeps the
namespace and registry-auth Service.

The `/v1/install` endpoint is available only before the first owner is created. After bootstrap, use
`compartment login --api-url <console-url>` to recover a local CLI session. To intentionally abandon an install
identity, uninstall the release and explicitly delete the retained Secret before reinstalling.

Deleting the namespace or retained registry-auth Service is a destructive reset that allows Kubernetes to allocate a
different ClusterIP. A subsequent install renders the new endpoint and reapplies the owned mirror idempotently when
the local-k3s safety conditions hold. Otherwise, update every node from the rendered instructions before the first
application deployment. Other distributions require the equivalent container-runtime mirror update and restart.

## Install domain operations

`compartment system domain` changes the whole-install domain through the API pod's private operator channel. It does
not expose a system endpoint through Caddy.

The operator flow is:

1. `system domain set` stages an operator-owned domain and prints the required address and ownership TXT records.
2. `system domain verify` proves DNS ownership and that traffic resolves directly to the release ingress.
3. For `custom-cert`, `system domain attach-cert` creates the operation-specific Kubernetes TLS Secret and mounts it
   only in API while the change is pending.
4. `system domain activate` applies the runtime domain, waits for API, Edge, and Caddy, finalizes the API operation, and
   commits the retained domain generation. Worker and project-provisioner do not roll for a domain change.

The operations are retryable. The retained generation prevents an older Helm render from replacing active domain
state. A release that started with a managed allocation keeps it while an operator domain is active;
`system domain reset-managed` restores that original allocation without requesting a new one.

See [Managed Platform Domains](./managed-platform-domains.md) for the durable domain ownership and broker invariants.

## Operator recovery and trust

`compartment system issue-password-reset --email <email>` issues a private one-time reset for an eligible existing
single-organization local-password account, including the owner. It uses `kubectl exec` into the API pod and prints a
secret token and expiry. It does not activate invited users or create credentials for SSO-only accounts.

All system-domain commands and password recovery require permission to get the API Deployment, list its Pods, and
create `pods/exec` in the release namespace. `attach-cert`, `activate`, and `reset-managed` also require the Helm
permissions needed to update the release.

Every CLI-owned Helm activation verifies the effective platform images again and passes only immutable digests to the
chart. The publication, signature identity, SBOM, and provenance contract is defined in
[Self-Hosted Image Publishing](./self-hosted-image-publishing.md).

The chart never exposes `/internal/*`, the private operator channel, install tokens, registry services, BuildKit, or
control-plane health routes through public ingress.

Readiness probes are HTTP requests from kubelet. On CNI implementations that filter node-originated probe traffic,
operators must allow node or kubelet traffic to the configured probe ports or the workloads can remain unready.
