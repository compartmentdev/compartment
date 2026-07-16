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

Before running the installer, reserve a stable public load-balancer address, point `console.apps.example.com` and
`*.apps.example.com` at it, and configure that load balancer to terminate TLS and forward HTTP to the Caddy NodePort
on the cluster nodes. The installer waits for this public HTTPS origin, so DNS and forwarding must already work.

Create an operator values file for that topology:

```yaml
platform:
  startupStage: full
  baseDomain: apps.example.com
  publicProtocol: https
  tlsMode: custom-http

service:
  caddy:
    type: NodePort
    httpNodePort: 30080

storage:
  storageClass: fast-rwo
```

Pin the `images.*.tag` values to one release or immutable `sha-*` tag. Supply the values under `secrets` through your
normal secret-management workflow instead of committing them. Install with the release CLI, which uses its bundled
matching chart, waits for the public Console endpoint, creates the first owner, and saves the owner session:

```bash
compartment install \
  --api-url https://console.apps.example.com \
  --base-domain apps.example.com \
  --values compartment-values.yaml
```

The command prompts for the first owner's email, organization, and password. Use `--kube-context`, `--namespace`, or
`--release-name` when the defaults are not appropriate. A CLI built directly from a source checkout has no embedded
chart; pass `--chart ./deploy/chart/compartment` in that case.

You can install the CLI and immediately start the same interactive platform install:

```bash
curl -fsSL https://compartment.dev/install.sh | sh -s -- \
  --init-install \
  --api-url https://console.apps.example.com \
  --base-domain apps.example.com \
  --values compartment-values.yaml
```

If the command stops before confirming owner creation, rerun it with the same release name, namespace, base domain,
and values. A deployed foundation or full release resumes without replaying foundation. If Helm reports a failed,
pending, or uninstalled release, repair or remove that release before retrying. After the owner was created, use
`compartment login --api-url <console-url>` instead of rerunning the one-time install endpoint.

This install path currently supports external TLS termination with `platform.tlsMode: custom-http` as shown above.
Managed-domain and chart-provided certificate onboarding are not available through this command.

The bundled registry is addressed inside the cluster as `<release-fullname>-registry-auth.<namespace>.svc:5000`.
Kubelets do not use cluster DNS for image pulls, so configure the container runtime on every node with an equivalent
registry mirror or route before deploying applications. The chart cannot mutate node-level container-runtime config.

Verify the migration Job and platform workloads before inviting more users:

```bash
kubectl --namespace compartment get jobs,pods,services
```

The chart does not publish `/internal/*`; only the documented control-plane and application paths pass through Caddy.

## Repository development

`install --dev` seeds the local development API started from this repository and creates the first admin session:

```bash
compartment install --dev --remote local-dev
```

Next steps:

- Read [Login, Activation, and the Control Plane](/manage-access/login-activation-and-the-control-plane/).
- Continue to [First Deploy](/quickstart/first-deploy/).
