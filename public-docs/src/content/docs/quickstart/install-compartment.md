---
title: Install Compartment
description: Install the Kubernetes platform or CLI, connect to a control plane, or seed a repository development environment.
---

## Install the CLI

Install the CLI with the public bootstrapper:

```bash
curl -fsSL https://compartment.dev/install.sh | sh
```

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

The default install uses a Kubernetes LoadBalancer Service on public ports 80 and 443. Its internal Caddy ports remain
8080 and 8443. Make sure your cluster can allocate a stable public LoadBalancer address before starting.

Create an operator values file with your storage and image decisions. The CLI supplies the managed-domain, ingress,
ACME email, and one-time install values; the chart supplies the ACME issuer and CA defaults:

```yaml
storage:
  storageClass: fast-rwo
```

Select one release with the `images.*.tag` values. Before Helm changes the release, the CLI verifies all four platform
images against Compartment's GitHub Actions signing identity, resolves each tag to its immutable digest, and deploys
only those digests. An unsigned image or an image signed by another identity stops the install before activation.
Supply the values under `secrets` through your normal secret-management workflow instead of committing them. Install
with the release CLI, which uses its bundled matching chart, waits for the public Console endpoint, creates the first
owner, and saves the owner session:

```bash
compartment install \
  --values compartment-values.yaml
```

The command prompts for the first owner's email, organization, and password. It creates the foundation release,
detects the Caddy LoadBalancer public IP, allocates a domain through `https://broker.compartment.run`, persists the
installation ID, domain allocation, and ingress addresses in a retained Kubernetes Secret, then completes the chart
with managed DNS-01 TLS. At runtime the broker credential is read from that Secret only by API and Caddy, never from a
ConfigMap. Helm also records supplied secret values in its Kubernetes release revision Secrets, so restrict access to
Helm and platform Secrets.

Use `--kube-context`, `--namespace`, or `--release-name` when the defaults are not appropriate. Pass
`--broker-url <url>` only for a managed-domain broker override. A CLI built directly from a source checkout has no
embedded chart; pass `--chart ./deploy/chart/compartment` in that case.

You can install the CLI and immediately start the same interactive platform install:

```bash
curl -fsSL https://compartment.dev/install.sh | sh -s -- \
  --init-install \
  --values compartment-values.yaml
```

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

The install-state Secret has Helm's `keep` policy so upgrades, resets, and an uninstall followed by reinstall retain
the installation ID, domain allocation, and ingress addresses. To intentionally abandon that identity, uninstall the
release and delete the Secret selected by both `app.kubernetes.io/instance=<release>` and
`app.kubernetes.io/component=install-state` before reinstalling. The next managed install requests a new allocation.

The bundled registry is addressed inside the cluster as `<release-fullname>-registry-auth.<namespace>.svc:5000`.
Kubelets do not use cluster DNS for image pulls, so configure the container runtime on every node with an equivalent
registry mirror or route before deploying applications. The chart cannot mutate node-level container-runtime config.

Verify the migration Job and platform workloads before inviting more users:

```bash
kubectl --namespace compartment get jobs,pods,services
```

The chart does not publish `/internal/*`; only the documented control-plane and application paths pass through Caddy.

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

## Repository development

`install --dev` seeds the local development API started from this repository and creates the first admin session:

```bash
compartment install --dev --remote local-dev
```

Next steps:

- Read [Login, Activation, and the Control Plane](/manage-access/login-activation-and-the-control-plane/).
- Continue to [First Deploy](/quickstart/first-deploy/).
