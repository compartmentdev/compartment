# Self-Hosted Install

This document captures the internal install and operator flow for the self-hosted runtime.

## Default Install

Default install uses the production managed-domain broker and the published self-hosted image tag embedded in the installed CLI build. Registry installs use GitHub Container Registry by default:

```bash
compartment install
```

The public `install.sh` bootstrapper installs the CLI binary only by default. It installs without `sudo` into the first supported user bin directory already on `PATH`: `$HOME/.local/bin` or `$HOME/bin`. If neither is on `PATH`, it falls back to `$HOME/.local/bin` and prints a concrete PATH instruction. Interactive shells can accept an automatic profile update: macOS `zsh` uses `~/.zprofile`, Linux `zsh` uses `~/.zshrc`, macOS `bash` uses `~/.bash_profile`, Linux `bash` uses `~/.bashrc`, and `fish` uses `~/.config/fish/config.fish`.

Public installer repository: [compartmentdev/compartment](https://github.com/compartmentdev/compartment)

## Bootstrap Flows

Copy-paste install from GitHub:

```bash
curl -fsSL https://raw.githubusercontent.com/compartmentdev/compartment/main/install.sh | sh -s -- --init-install
```

Copy-paste update from GitHub for an existing self-hosted install:

```bash
curl -fsSL https://raw.githubusercontent.com/compartmentdev/compartment/main/install.sh | sh -s -- --version main --init-update
```

Install the CLI on another computer and log in to an existing runtime:

```bash
curl -fsSL https://raw.githubusercontent.com/compartmentdev/compartment/main/install.sh | sh -s -- --init-login --api-url https://console.example.com --email admin@example.com
```

- `--init-install` immediately starts the server install.
- `--init-update` refreshes the CLI binary and then runs `compartment system update`.
- `--init-login --api-url <url> --email <email>` installs the CLI and immediately runs `compartment login`.

## Local Image Install

To install from locally built self-hosted images, build the images from the repository root first:

```bash
pnpm self-hosted:build
```

Then run the system install:

```bash
compartment install --image-source local --local-runtime
```

## Runtime Layout

- `compartment install` prompts for the first admin email, organization name, password, and public HTTP/HTTPS ports.
- Public ports default to `80` and `443`.
- Config, compose, and env files live in `/etc/compartment`.
- State, install backups, and docker work files live in `/var/lib/compartment/self-hosted`.
- Self-hosted API and worker containers use the fixed `compartment-runtime` identity (`10001:10001`); supporting
  services keep their service-specific runtime users.
- Runtime files are `/etc/compartment/.env.self-hosted`, `/etc/compartment/docker-compose.self-hosted.yml`, and
  `/var/lib/compartment/self-hosted/install-state.json`.
- The pre-release `onprem` runtime layout, including `/etc/compartment/.env.onprem` and `/var/lib/compartment/onprem/install-state.json`, is not a supported install or update source.
- The runtime socket root is `/var/run/compartment`: System API uses `/var/run/compartment/api/system-api.sock`, and the host node agent uses `/var/run/compartment/node/agent.sock`.
- `compartment install` stages `/usr/local/bin/compartment-node-agent` and `compartment-node-agent.service`; API and worker containers talk to that host service over the node-agent Unix socket.
- Self-hosted source builds use a rootful BuildKit container listening only on `unix:///run/buildkit/buildkitd.sock`; the worker reaches BuildKit through a named Docker volume, not TCP. The BuildKit socket group is the fixed runtime GID `10001`.
- BuildKit runs on the separate `build_internal` Docker network. The worker stays on `system_internal`, and `registry-auth` bridges `system_internal` and `build_internal` so builds can push images without giving build execution access to API, database, edge, or Caddy service networks.
- The system install requires root privileges.
- In the default non-root path, the `sudo` worker only performs system setup and first signup.
- The user-level parent process writes `~/.config/compartment-cli/config.json`.
- No custom owner env variables are passed through `sudo`.
- `--local-runtime` sets browser hosts to `127.0.0.1.sslip.io` and uses HTTPS browser URLs.
- The bundled self-hosted runtime starts the artifact registry only on the internal Docker network. Host-loopback access goes through `registry-auth`, which requires generated read/write credentials; workers and runtime pulls use those credentials instead of unauthenticated registry access.

Default install permissions:

- `/etc/compartment`, `/var/lib/compartment/self-hosted`, and `/var/run/compartment` remain private root-owned directories with mode `0700`.
- `/var/run/compartment/api`, docker work, source archive, resource backup, and audit sink directories are owned by `10001:10001` with mode `0700`.
- Custom TLS directories are owned by `root:10001` with mode `0750`; custom TLS files are `root:10001` with mode `0640`.
- `/var/run/compartment/node` is owned by `root:10001` with mode `0750`; `agent.sock` is `root:10001` with mode `0660`.
- `/etc/compartment/.env.self-hosted`, install state, backup metadata, and `system-api.sock` remain owner-only files or sockets with mode `0600`.
- `/usr/local/bin/compartment-node-agent` is `0755`; the systemd unit is `0644` and contains no secrets.

## Mode And Version Selection

- The default broker URL is `https://broker.compartment.run`.
- Use `--base-domain`, `--local-runtime`, or `--dev` for explicit non-managed-domain modes.
- `sslip.io` is used only by `--local-runtime`.
- Use `--broker-url` only to override the broker URL, usually for local broker development.

Published registry installs default to the runtime tag embedded in the current CLI build. Source checkouts default to `latest`, rolling `main` CLI builds default to their matching `sha-<commit>` tag, and stable release CLI builds default to their matching release tag.

Registry installs and updates must use the runtime tag embedded in the packaged CLI so the host node-agent binary and container images stay on the same build. Use `--version` only to select that packaged tag explicitly, or with `--image-source local` for a locally built tag:

- `compartment install --version latest`
- `compartment install --version main`
- `compartment install --version sha-<commit>`
- `compartment install --version 0.2.0`

`--image-source local` keeps the same tag selection and skips pulling from the registry, so the selected tag must already exist in the local Docker daemon.

`--image-registry github` selects `ghcr.io/compartmentdev`; `--image-registry docker-hub` selects `docker.io/compartmentdev`. New installs persist the selected image registry in `install-state.json`. States created before `imageRegistry` existed default registry updates to GHCR; local-image states keep Docker Hub-style names unless explicitly changed.

## Host Dependencies

On Ubuntu and Debian hosts, `compartment install` can install Docker Engine and the Docker Compose plugin when they are missing, but it first asks for confirmation. The install flow may prompt for `sudo` while it checks Docker access or installs the packages.

To initialize a running local dev API from the repository instead of packaged self-hosted runtime, use:

```bash
compartment install --dev
```

## Operator Commands

To inspect or restart an existing self-hosted install, use:

```bash
sudo compartment system status
sudo compartment system restart
```

To update an existing self-hosted install after upgrading the CLI binary, run:

```bash
sudo compartment system update
```

The CLI reads the current image source and image registry from `/var/lib/compartment/self-hosted/install-state.json`. It stores any `--image-source registry`, `--image-source local`, or `--image-registry <registry>` override in that state file for subsequent updates, and skips the update when the requested release version is not newer than the installed one and the runtime image selection is unchanged.

`system update` also refreshes the host node-agent binary and systemd unit, restarts the agent before recreating Docker runtime services so their bind mount sees the current agent socket directory, then waits for the agent socket to become healthy.

## Install Domain Operations

To move an installed runtime to an operator-owned domain, stage the host plan, add the DNS records printed by the command, then verify and activate:

```bash
sudo compartment system domain set --base-domain customer.example.com --tls external --public-scheme https
sudo compartment system domain verify
sudo compartment system domain activate
sudo compartment system domain status
```

With `--tls external --public-scheme https`, public HTTPS terminates before Compartment, for example at Cloudflare, and Compartment serves the origin over HTTP. Plain HTTP public browser URLs are not supported because browser login and hosted-app access use secure host-bound cookies.

For a provided certificate, use `--tls custom-cert`, attach the staged cert before verify or activate, and let `verify` check DNS:

```bash
sudo compartment system domain attach-cert --cert-file /path/fullchain.pem --key-file /path/privkey.pem
```

Managed-domain installs can return to the originally allocated managed domain with:

```bash
sudo compartment system domain reset-managed
```

`reset-managed` does not allocate a new broker domain or repair broker DNS. It uses the managed-domain metadata already stored in `/var/lib/compartment/self-hosted/install-state.json`, rewrites the local runtime env, restarts the runtime, clears any pending domain setup state, and refreshes edge app routing.
