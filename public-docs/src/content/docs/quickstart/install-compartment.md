---
title: Install Compartment
description: Install the Kubernetes platform or CLI, connect to a control plane, or seed a repository development environment.
---

## Install the CLI

Install the CLI with the public bootstrapper:

```bash
curl -fsSL https://compartment.dev/install.sh | sh
```

To install the current Kubernetes branch CLI, select its channel:

```bash
curl -fsSL https://compartment.dev/install.sh | sh -s -- --channel kubernetes
```

The bootstrapper resolves the branch head to an immutable OCI artifact, verifies its keyless signature against the
Kubernetes publish workflow identity, and only then downloads the CLI. An unsigned artifact or a signature from
another identity stops the install. This CLI includes the matching Helm chart.

For a verified install from an immutable stable release, use GitHub CLI 2.81.0 or newer:

```bash
gh release verify --repo compartmentdev/compartment
gh release download --repo compartmentdev/compartment --pattern install.sh --clobber
gh release verify-asset --repo compartmentdev/compartment ./install.sh
sh ./install.sh
```

## Connect to a control plane

Log in with the Console URL supplied by your Compartment operator:

```bash
compartment login --api-url https://console.example.com --organization acme-dev
```

Pass `--email <email>` to prefill the browser login form. Name the remote when one machine connects to multiple control planes:

```bash
compartment login --remote prod-eu --api-url https://console.example.com
```

The public bootstrapper can install the CLI and immediately start the login flow:

```bash
curl -fsSL https://compartment.dev/install.sh | sh -s -- --init-login --api-url https://console.example.com
```

## Install the platform on Kubernetes

The production platform is a Helm release. It requires Kubernetes 1.30 or newer, Helm 4.x, a default or explicitly
selected `ReadWriteOnce` storage class, and nodes that can pull application images from the bundled registry. The
selected Kubernetes context must be allowed to manage the chart's Namespaces, ClusterRoles, ClusterRoleBinding,
ValidatingAdmissionPolicy, and ValidatingAdmissionPolicyBinding as well as namespaced resources.
The machine running the CLI must also reach every configured platform-image registry and the Sigstore trust services
used by cosign.

Readiness probes use HTTP traffic from kubelet. If your CNI filters node-originated probe traffic, allow node or
kubelet traffic to the configured probe ports or platform workloads can remain unready.

The default install uses a Kubernetes LoadBalancer Service on public ports 80 and 443. Its internal Caddy ports remain
8080 and 8443. Start the guided install from an interactive terminal:

```bash
compartment install
```

Before asking for configuration or owner credentials, the CLI selects a usable kubeconfig, checks cluster access,
and checks whether another LoadBalancer Service exposes port 80 or 443. When `KUBECONFIG` is set, all paths in it
are merged and treated as authoritative; an invalid explicit value fails instead of falling back to another cluster.
Otherwise, the CLI tries a usable `~/.kube/config` with the explicit `--kube-context` or its current context and
cluster, then the readable k3s config at
`/etc/rancher/k3s/k3s.yaml`. The wizard then asks only
for managed or custom domain setup, the storage class, and the first owner's email, organization, and password. It
prefers `local-path` when the cluster provides that storage class. For `custom-cert`, create the Kubernetes TLS Secret
first; the wizard asks for its existing name.

k3s with klipper assigns LoadBalancer ports through shared node host ports. In that environment, a foreign
LoadBalancer on port 80 or 443 blocks installation; k3s installs Traefik this way by default. Install k3s without
Traefik, or disable and remove it before retrying Compartment:

```bash
printf 'disable:\n  - traefik\n' >/etc/rancher/k3s/config.yaml
systemctl restart k3s
kubectl -n kube-system delete helmchart traefik traefik-crd
```

On clusters where LoadBalancer Services receive separate addresses, such as managed cloud load balancers or MetalLB,
another ingress LoadBalancer produces a warning instead. The guided wizard asks you to confirm that you want to
continue. An install using `--values` prints the warning and continues without adding a prompt.

For CI or advanced operator configuration, create a values file with your storage and image decisions and pass it
with `--values`. Non-interactive installs require this file. The CLI supplies managed-domain, ingress, ACME email, and
one-time install values; the chart supplies the ACME issuer and CA defaults:

```yaml
storage:
  storageClass: fast-rwo
```

Optionally set `platform.rollbackRetentionLimit` to a positive integer for the install-wide rollback-image limit
inherited by organizations without an override. Its empty default retains rollback images indefinitely. Tune login,
account activation, and password-reset throttles under `platform.authThrottle.{login,activation,passwordReset}`. Each
flow exposes a route `window` and `limit`; source and account or subject scopes also expose a `cooldown`. Keep the chart
defaults unless your traffic and incident-response requirements call for different protection.

The release CLI defaults all four `images.*.tag` values to its packaged platform version. Explicit tags in your
operator values file take precedence. Before Helm changes the release, the CLI verifies all four platform images
against Compartment's GitHub Actions signing identity, resolves each tag to its immutable digest, and deploys only
those digests. An unsigned image or an image signed by another identity stops the install before activation.
Supply the values under `secrets` through your normal secret-management workflow instead of committing them. Install
with the release CLI, which uses its bundled matching chart, waits for the public Console endpoint, creates the first
owner, and saves the owner session:

```bash
compartment install \
  --values compartment-values.yaml
```

With `--values`, the configuration wizard is skipped but the same preflight checks and existing owner prompts still
run. In the managed-domain example above, the command creates the foundation release, detects the Caddy LoadBalancer
public IP, allocates a domain through `https://broker.compartment.run`, persists the installation ID, domain
allocation, and ingress addresses in a retained Kubernetes Secret, then completes the chart with managed DNS-01 TLS.
At runtime the broker credential is read from that Secret only by API and Caddy, never from a ConfigMap. Helm also
records supplied secret values in its Kubernetes release revision Secrets, so restrict access to Helm and platform
Secrets.

After the platform and first owner are ready, the CLI reads the installed registry-auth Service and prints the exact
k3s `registries.yaml` entry using its actual ClusterIP. It also prints a ready `compartment system registry-mirror
apply` command that safely merges the entry, writes the file, and restarts k3s without replacing other mirrors.
Complete this required node-level step before the first application deploy. The chart cannot change container-runtime
configuration on Kubernetes nodes.

When the CLI is running as root on the local k3s node with an unambiguous
`KUBECONFIG=/etc/rancher/k3s/k3s.yaml` and `systemctl` is available, it merges only the installed Compartment mirror
into `/etc/rancher/k3s/registries.yaml` and restarts k3s automatically when the config changes. It preserves other
registry mirrors. A declarative `--values` install applies it automatically and logs the action; a guided install asks
for confirmation with a default of yes.
Pass `--skip-registry-mirror` to decline automatic application. Automatic application configures only the local node;
make the same Compartment CLI version available and run the printed apply command on every other k3s node in the
cluster. The command exits unsuccessfully if k3s does not restart or the written endpoint fails its post-check. If any
safety condition is not met, use the printed instructions on every k3s node. Other Kubernetes distributions require
the equivalent container-runtime mirror or route.

Use `--kube-context`, `--namespace`, or `--release-name` when the defaults are not appropriate. Pass
`--broker-url <url>` only for a managed-domain broker override. A CLI built directly from a source checkout has no
embedded chart; pass `--chart ./deploy/chart/compartment` in that case. Source builds retain the chart and operator
image tags, so set all four `images.*.tag` values explicitly when you need a pinned source install.

You can install the CLI and immediately start the same interactive platform install:

```bash
curl -fsSL https://compartment.dev/install.sh | sh -s -- \
  --channel kubernetes \
  --init-install \
  --values compartment-values.yaml
```

This path omits `--base-domain`, so it requests a managed domain. To use your own domain through the bootstrapper,
add `--base-domain <baseDomain>`; add `--api-url <console-url>` only when you need to state the derived Console URL
explicitly.

If the command stops before confirming owner creation, rerun it with the same release name, namespace, domain mode,
and values. For managed domains, omit `--base-domain` again. A deployed release resumes its saved allocation; a
reinstall with the same release coordinates reuses the retained install-state Secret. If Helm reports a failed or
pending release, repair or remove that release before retrying. After the owner was created, use `compartment login
--api-url <console-url>` instead of rerunning the one-time install endpoint.

For your own base domain, point `console.<baseDomain>` and `*.<baseDomain>` to the Caddy LoadBalancer, then pass
`--base-domain <baseDomain>`. The installer derives the Console URL; `--api-url` remains available when you need to
state it explicitly. If the Caddy Service is not a LoadBalancer, set `platform.publicIngressIpv4` or
`platform.publicIngressIpv6` in the operator values file.

To terminate TLS in Caddy with your certificate, create a TLS Secret in the release namespace and select it:

```bash
kubectl create namespace compartment --dry-run=client --output yaml \
  | kubectl apply --filename -
kubectl --namespace compartment create secret tls compartment-public-tls \
  --cert fullchain.pem \
  --key privkey.pem
```

```yaml
platform:
  tlsMode: custom-cert
  # The CLI replaces this with the first owner's email.
  acmeEmail: admin@example.com

customTls:
  existingSecret: compartment-public-tls
```

The chart mounts that one Secret read-only in both API and Caddy at the canonical certificate and key paths. The ACME
email is used for on-demand tenant certificates outside the platform certificate. For an external TLS terminator, use
`platform.tlsMode: custom-http`, set the explicit public ingress address, and configure the Caddy Service topology
required by that load balancer. Select the TLS mode and create any referenced Secret before running `compartment
install`. If certificate and key material are supplied inline instead, Helm retains them in its release revision
Secrets; `customTls.existingSecret` is preferred. When rotating an existing Secret in place, change
`platform.rolloutMarker` so API and Caddy restart and Caddy reloads the certificate.

The install-state Secret and registry-auth Service have Helm's `keep` policy. An uninstall followed by reinstall with
the same namespace and release name retains the installation ID, domain allocation, ingress addresses, and registry
ClusterIP, so an existing node registry mirror remains valid. Keep the namespace and registry-auth Service during this
supported reinstall path. To intentionally abandon only the install identity, uninstall the release and delete the
Secret selected by both `app.kubernetes.io/instance=<release>` and
`app.kubernetes.io/component=install-state` before reinstalling. The next managed install requests a new allocation.

For a same-release reinstall, record the registry address, uninstall without deleting the namespace, and confirm that
Helm retained the Service. Rerun the same Compartment install command with the same namespace, release name, and values,
then repeat the final check before deploying applications:

```bash
registry_service=compartment-compartment-registry-auth
registry_ip="$(kubectl --namespace compartment get service "$registry_service" --output jsonpath='{.spec.clusterIP}')"
helm uninstall compartment --namespace compartment
test "$(kubectl --namespace compartment get service "$registry_service" --output jsonpath='{.spec.clusterIP}')" = "$registry_ip"
# Rerun the same compartment install command here.
test "$(kubectl --namespace compartment get service "$registry_service" --output jsonpath='{.spec.clusterIP}')" = "$registry_ip"
```

If you delete the namespace or retained registry-auth Service, reinstall can allocate a different ClusterIP. The CLI
renders the new endpoint after reinstall and idempotently updates the same mirror key when local-k3s auto-application
is available. Otherwise, apply the newly printed instructions on every node before deploying an application.

Verify the Helm release and platform workload readiness before inviting more users:

```bash
compartment system status \
  --namespace compartment \
  --release-name compartment
```

The chart does not publish `/internal/*`; only the documented control-plane and application paths pass through Caddy.

See the generated [`compartment install` reference](/reference/generated/cli/install/) for the complete option list.

## Maintain the Kubernetes platform

Check the Helm release state and the readiness of its Deployments and DaemonSets:

```bash
compartment system status --namespace compartment --release-name compartment
```

Restart the API, Worker, Edge, Caddy, Project Provisioner, and Registry Auth Deployments and wait for their rollouts.
This leaves PostgreSQL, the stateful registry, and BuildKit running:

```bash
compartment system restart --namespace compartment --release-name compartment
```

Update with a release CLI and its matching bundled chart. Supply the same operator values file used for installation:

```bash
compartment system update \
  --values compartment-values.yaml \
  --namespace compartment \
  --release-name compartment
```

The release CLI selects its packaged platform version. Before Helm activates it, the CLI verifies the new API, Worker,
Edge, and Caddy image signatures against Compartment's signing identity and resolves their immutable digests. An
unsigned image or a different signing identity stops the update before Helm changes the release. A source CLI build
requires both `--version <image-tag>` and `--chart ./deploy/chart/compartment`.

The public bootstrapper can download the selected release CLI and immediately run the same verified update:

```bash
curl -fsSL https://compartment.dev/install.sh | sh -s -- \
  --channel kubernetes \
  --init-update \
  --values compartment-values.yaml
```

Use `--channel kubernetes` to stay on the Kubernetes line. This channel always resolves the current Kubernetes branch
HEAD and does not support version pinning; the installer rejects combining it with `--version`. Use
`--version <release>` or `--channel main` only when you intend to switch to that release line. The operator needs normal
Helm update permissions, permission to list the release's Deployments and DaemonSets for status, and permission to
restart and watch the API, Worker, Edge, Caddy, Project Provisioner, and Registry Auth Deployments.

See the generated [`compartment system` reference](/reference/generated/cli/system/) for all lifecycle command options.

## Change the system domain

Use `compartment system domain` with the Helm release coordinates. Start by checking the active and pending state:

```bash
compartment system domain status \
  --namespace compartment \
  --release-name compartment
```

Stage a custom domain after you point `console.<baseDomain>` and `*.<baseDomain>` at the public load balancer:

```bash
compartment system domain set \
  --base-domain apps.example.com \
  --tls external \
  --namespace compartment \
  --release-name compartment
```

Publish every DNS record printed by `set`, including the operation-specific ownership TXT record, and wait for DNS
propagation. Then verify the pending domain:

```bash
compartment system domain verify \
  --namespace compartment \
  --release-name compartment
```

Use `--tls custom-cert` when Caddy terminates TLS. Attach the certificate before verification:

```bash
compartment system domain attach-cert \
  --cert-file fullchain.pem \
  --key-file privkey.pem \
  --values compartment-values.yaml \
  --namespace compartment \
  --release-name compartment
```

The chart stores the certificate and key in an operation-specific Kubernetes TLS Secret; it never places them in a
ConfigMap. Helm also retains those supplied values in its Kubernetes release revision Secrets. Publish the DNS records
printed by `set` and wait for propagation before verification. Activate the verified domain with the same operator
values and matching chart:

```bash
compartment system domain activate \
  --values compartment-values.yaml \
  --namespace compartment \
  --release-name compartment
```

Activation rolls API, Edge, and Caddy, waits for them, records the activation, and only then commits the retained
domain generation. Worker and project-provisioner pods keep running. If the command stops, rerun it. The generation
check prevents older domain values from replacing the retained active state.

Before `attach-cert`, `activate`, or `reset-managed` changes the Helm release, the CLI re-verifies the effective API,
Worker, Edge, and Caddy images and stops the rollout if any image fails the signing policy.

An installation that started with a managed domain retains that allocation when you activate a custom domain. Restore
it with:

```bash
compartment system domain reset-managed \
  --values compartment-values.yaml \
  --namespace compartment \
  --release-name compartment
```

Pass `--chart ./deploy/chart/compartment` to domain commands that change Kubernetes resources when you use a CLI built
from source. `--kube-context`, `--namespace`, and `--release-name` select another release. The system commands use the
operator's Kubernetes access and do not publish a recovery endpoint through Caddy. Every system-domain command and
password recovery needs permission to get the API Deployment, list its Pods, and create the `pods/exec` subresource.
Only `attach-cert`, `activate`, and `reset-managed` additionally need the normal Helm upgrade permissions for the
chart's resources.

See the generated [`compartment system domain` reference](/reference/generated/cli/system/domain/) for command options.
If the owner is locked out, follow [Troubleshoot Access](/manage-access/troubleshoot-access/#a-local-password-user-is-locked-out)
for the private operator password-reset flow.

## Repository development

`install --dev` seeds the local development API started from this repository and creates the first admin session:

```bash
compartment install --dev --remote local-dev
```

Next steps:

- Read [Login, Activation, and the Control Plane](/manage-access/login-activation-and-the-control-plane/).
- Continue to [First Deploy](/quickstart/first-deploy/).
