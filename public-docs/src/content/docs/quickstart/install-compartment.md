---
title: Install the CLI
description: Install the Compartment CLI, connect to an existing control plane, or seed a repository development environment.
---

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

## Repository development

`install --dev` is the only CLI-owned platform setup mode. It seeds the local development API started from this repository and creates the first admin session:

```bash
compartment install --dev --remote local-dev
```

Production platform installation is operator-owned through the Compartment Helm chart; the CLI does not install or manage a host runtime.

Next steps:

- Read [Login, Activation, and the Control Plane](/manage-access/login-activation-and-the-control-plane/).
- Continue to [First Deploy](/quickstart/first-deploy/).
