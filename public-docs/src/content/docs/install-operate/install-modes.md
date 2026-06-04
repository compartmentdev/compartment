---
title: Install Modes
description: Understand the current shipped install command and the supported system-install modes.
---

If the CLI is already installed on the target server, install the platform with:

```bash
compartment install
```

Before you run `compartment install`, the CLI must already be installed on the target server. The public bootstrapper can either install the CLI only or install the CLI and immediately start `compartment install`.

## Default mode

With no explicit mode flags, `compartment install` allocates a managed base domain through the broker and configures the self-hosted runtime with trusted HTTPS.

Registry installs verify Compartment runtime image signatures with the bundled CLI verifier before pulling images and before activating runtime files or starting containers. A failed verification leaves the install directory retryable.

Registry installs pull the `api`, `caddy`, `edge`, `worker`, and `runtime-probe` images from GitHub Container Registry by default. Use `--image-registry docker-hub` when you need Docker Hub image refs instead. The selected registry is stored for later `system update` runs.

Use other modes only when you need a different ownership model:

- `--base-domain <domain>`: use an operator-owned install domain.
- `--local-runtime`: use local HTTPS browser hosts for local runtime work.
- `--dev`: point the CLI at a local development API from this repository.
- `--broker-url <url>`: override the managed-domain broker, usually for broker development.

Use `--image-source local` when you want the install to use images already built into the local Docker daemon. Local image installs skip registry signature verification, so all runtime images must already exist locally.

## CLI bootstrap options

Install the CLI only:

```bash
curl -fsSL https://compartment.dev/install.sh | sh
```

Verified install from an immutable stable release with GitHub CLI 2.81.0 or newer:

```bash
gh release verify --repo compartmentdev/compartment
gh release download --repo compartmentdev/compartment --pattern install.sh --clobber
gh release verify-asset --repo compartmentdev/compartment ./install.sh
sh ./install.sh --init-install
```

The verified path checks the latest immutable GitHub Release and the downloaded `install.sh` asset before execution.

Install the CLI and immediately start the system install:

```bash
curl -fsSL https://compartment.dev/install.sh | sh -s -- --init-install
```

Install the CLI on another machine and immediately start `compartment login`:

```bash
curl -fsSL https://compartment.dev/install.sh | sh -s -- --init-login --api-url https://console.example.com
```

The installer prompts for the email address. For non-interactive automation, pass `--email <email>`.

Related commands:

- `compartment install`
- `compartment login`
- `sudo compartment system status`
- `sudo compartment system update`

Next steps:

- Read [Install Domain](/install-operate/install-domain/).
- Read [System Operations](/install-operate/system-operations/).
