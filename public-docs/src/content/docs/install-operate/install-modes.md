---
title: Install Modes
description: Choose between a managed VM installation and an existing Kubernetes cluster.
---

Compartment always runs on Kubernetes. `compartment install` supports two installation targets:

- **Managed VM** provisions and owns k3s on a clean VM, then installs Compartment into that cluster.
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

Use a fresh x86_64 VM when you want Compartment to manage the Kubernetes installation as well as the platform. Ubuntu
24.04 LTS is tested:

```bash
compartment install --target vm
```

This target provisions a single-node k3s cluster. It is the shortest production setup path, but it is not highly
available: losing the VM interrupts the control plane and workloads on that node.

The managed-VM installer asks whether to use a managed Compartment domain or an operator-owned base domain. Because
Compartment owns this host, it automatically installs cert-manager, creates the internal registry CA and Issuer,
adds that CA to node trust, and installs gVisor/runsc. It does not ask you for a pre-created issuer or runtime.

Run its preflight without changing the machine:

```bash
compartment install --target vm --check --output json
```

After installation, follow [Operate a Managed VM](/guides/operate-managed-vm/) for status, updates, diagnostics, and
recovery.

## Existing Kubernetes

Use this target when your organization already operates Kubernetes 1.35 or newer, or a cluster with
`ImageVolume=true` on kube-apiserver, every eligible kubelet, and every autoscaler or machine-template bootstrap path:

```bash
compartment install --target kubernetes --kube-context production
```

The installer verifies the image-volume API and a real mount on every current Ready schedulable node, then checks the
remaining required Kubernetes APIs, cert-manager, ingress, storage, registry trust, policy
enforcement, and permissions before installing the Helm release. It discovers namespaced Issuers and cluster-wide
ClusterIssuers and lets you select an observed issuer. If cert-manager is absent or no issuer resource is discovered,
setup stops with the prerequisite and exact next commands before collecting an impossible issuer name. It does not
install an ingress controller, change node container-runtime or CA-trust configuration, or take ownership of cluster
upgrades and backups.

For autoscaled clusters, `capacityHeadroom.replicas` controls preemptible tenant-capacity placeholders that signal an
operator-installed compatible autoscaler. Set it to zero to accept saturation or increase it to reserve more free
allocations. You remain responsible for node reservations, eviction headroom, and cloud-node bootstrap.

The Helm release installs Capsule 0.13.11 and its cluster-scoped quota resources. Pod and persistent volume claim
creates and updates fail closed in Compartment-managed project namespaces, so those operations are rejected while
the webhook is unavailable. Delete notifications fail open so teardown remains available; periodic reconciliation
repairs released-capacity accounting after Capsule recovers. A successful quota state becomes eligible for that
refresh after 15 minutes. Platform and build namespaces are not selected.

For non-interactive installation, `--target vm|kubernetes` is required. Provide the remaining owner, domain, cluster,
and values inputs explicitly.

Next steps:

- Follow the complete [Install Compartment](/quickstart/install-compartment/) workflow.
- Choose the [Install Domain](/install-operate/install-domain/).
- Review [System Operations](/install-operate/system-operations/).
