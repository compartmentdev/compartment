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
selected `ReadWriteOnce` storage class, and nodes that can pull application images from the bundled registry.

Create an operator values file. This example expects an external load balancer to terminate TLS and forward HTTP to
the Caddy Service:

```yaml
platform:
  startupStage: full
  baseDomain: apps.example.com
  publicProtocol: https
  tlsMode: custom-http

service:
  caddy:
    type: LoadBalancer

storage:
  storageClass: fast-rwo
```

Pin the `images.*.tag` values to one release or immutable `sha-*` tag. Supply the values under `secrets` through your
normal secret-management workflow instead of committing them. Install from the matching source release:

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

Point `console.apps.example.com` and `*.apps.example.com` at the public load balancer. If your load balancer does not
terminate TLS, choose a supported Caddy TLS mode and provide its required certificate or managed-domain configuration.

The bundled registry is addressed inside the cluster as `<release-fullname>-registry-auth.<namespace>.svc:5000`.
Kubelets do not use cluster DNS for image pulls, so configure the container runtime on every node with an equivalent
registry mirror or route before deploying applications. The chart cannot mutate node-level container-runtime config.

Verify the migration Job and platform workloads before inviting users:

```bash
kubectl --namespace compartment get jobs,pods,services
```

The chart does not publish `/internal/*`; only the documented control-plane and application paths pass through Caddy.

## Repository development

`install --dev` is the only CLI-owned platform setup mode. It seeds the local development API started from this repository and creates the first admin session:

```bash
compartment install --dev --remote local-dev
```

The CLI does not install or manage the production platform.

Next steps:

- Read [Login, Activation, and the Control Plane](/manage-access/login-activation-and-the-control-plane/).
- Continue to [First Deploy](/quickstart/first-deploy/).
