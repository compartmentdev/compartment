---
title: Install Modes
description: Choose between a managed VM installation and an existing Kubernetes cluster.
---

Compartment always runs on Kubernetes. `compartment install` supports two installation targets:

- **Managed VM** provisions and owns k3s on a clean Ubuntu VM, then installs Compartment into that cluster.
- **Existing Kubernetes** installs Compartment into a cluster whose lifecycle, nodes, ingress, storage, and backups you
  operate.

Installing the `compartment` CLI is a separate first step for both targets:

```bash
curl -fsSL https://compartment.dev/install.sh | sh
compartment install
```

In an interactive terminal, the installer resumes an existing managed-VM installation first. Otherwise, it selects
an accessible Kubernetes context when one is available and selects the managed-VM path when no usable cluster is
configured. The installer shows the selected target and a mutation review before it changes the host or cluster.

## Managed VM

Use a fresh Ubuntu 24.04 LTS x86_64 VM when you want Compartment to manage the Kubernetes installation as well as the
platform:

```bash
compartment install --target vm
```

This target provisions a single-node k3s cluster. It is the shortest production setup path, but it is not highly
available: losing the VM interrupts the control plane and workloads on that node.

Run its preflight without changing the machine:

```bash
compartment install --target vm --check --output json
```

After installation, follow [Operate a Managed VM](/guides/operate-managed-vm/) for status, updates, diagnostics, and
recovery.

## Existing Kubernetes

Use this target when your organization already operates Kubernetes 1.30 or newer:

```bash
compartment install --target kubernetes --kube-context production
```

The installer verifies the required Kubernetes APIs, cert-manager, ingress, storage, registry trust, policy
enforcement, and permissions before installing the Helm release. It does not install an ingress controller, change
node container-runtime configuration, or take ownership of cluster upgrades and backups.

For non-interactive installation, `--target vm|kubernetes` is required. Provide the remaining owner, domain, cluster,
and values inputs explicitly.

Next steps:

- Follow the complete [Install Compartment](/quickstart/install-compartment/) workflow.
- Choose the [Install Domain](/install-operate/install-domain/).
- Review [System Operations](/install-operate/system-operations/).
