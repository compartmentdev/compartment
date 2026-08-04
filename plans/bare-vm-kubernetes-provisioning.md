# Bare-VM Kubernetes provisioning plan

Status: proposed

Goal: a customer starts with a clean VM, runs the public Compartment bootstrap, and receives a working Compartment installation without preparing Kubernetes, ingress, storage, a CNI, or cert-manager.

This plan adds a host-provisioning layer in front of the existing Kubernetes installer. It does not create a second platform installer:

```text
inspect and prepare the host
-> provision a Compartment-owned k3s cluster from the supported release channel
-> install compatible cluster prerequisites
-> produce a kubeconfig
-> call the existing installIntoKubernetes(input)
```

The existing-cluster path remains supported and keeps its current ownership boundary.

## Recommendation

Build a small Compartment-owned provisioner around **k3s**, in the CLI, and keep `installIntoKubernetes(input)` as the only platform installation application service.

Do not adopt Replicated Embedded Cluster, kURL, k0s, RKE2, or MicroK8s for v1:

- k3s already supplies the exact CNI, kube-proxy, NetworkPolicy controller, CoreDNS, Traefik, ServiceLB, and local-path StorageClass shape used by the repository's supported tests;
- the current installer already knows how to install Compartment into that shape;
- a third-party appliance framework would replace a proven runtime boundary, add another release and upgrade contract, and still require Compartment-specific work for domains, registry reachability, first-owner bootstrap, and retained state;
- the provisioner should own only host and cluster prerequisites, then delegate immediately to the canonical installer.

Kubernetes compatibility must not be expressed as one exact k3s build. The public contract is a supported upstream Kubernetes minor window plus capability checks for the APIs and cluster behavior Compartment needs. The provisioned-VM path follows the current Compartment-supported k3s channel and is tested through the same compatibility gates as existing clusters.

### Version policy

- Existing clusters are accepted by supported Kubernetes minor range and capability checks, not by matching a k3s distribution patch.
- Compartment-managed VMs follow the current tested k3s release channel. The user does not choose, pin, or maintain a Kubernetes version during first installation.
- A particular installation still records the resolved k3s and cert-manager artifacts and their digests. This is installation evidence and a rollback input, not a public compatibility pin.
- CI selects explicit versions so each run is reproducible, but exercises at least the current and previous supported Kubernetes minors. Automated dependency updates keep that matrix moving.
- The privileged installer must not resolve an unbounded `latest` URL at runtime. Otherwise the same Compartment release can install different, untested bytes on different days.

## Competitive research

### What the comparable installers do

| System                                                                                              | First-run model                                                                                           | Good pattern to reuse                                                                                                                  | Important weakness for Compartment                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Coolify](https://coolify.io/docs/get-started/installation)                                         | `curl ... \| sudo bash`; installs Docker and the product                                                  | One obvious command, explicit host requirements, rerunnable installer, prints the access URL                                           | The script gets root before its payload is independently verified; first-admin registration is temporarily exposed on a public IP; support claims are broad but several systems need manual Docker setup |
| [Dokploy](https://docs.dokploy.com/docs/core/installation)                                          | `curl ... \| sh`; installs Docker and initializes Swarm                                                   | Checks required ports, supports an explicit advertise address and network CIDR override, versioned release installers                  | The manual path force-leaves an existing Swarm; public-IP inference and host mutation are easy to miss; HTTPS is a post-install step                                                                     |
| [Dokku](https://dokku.com/docs/getting-started/installation/)                                       | Versioned bootstrap on a fresh VM                                                                         | Narrows the contract to a fresh VM and makes the installed version explicit                                                            | Package/bootstrap lifecycle is Docker-specific and does not solve Kubernetes prerequisite ownership                                                                                                      |
| [CapRover](https://caprover.com/docs/get-started.html)                                              | Docker must exist, then one `docker run` and a second setup flow                                          | Separates runtime installation from domain setup and tests wildcard DNS                                                                | Uses a public setup port and documented default password; requires multiple setup phases and broad firewall openings                                                                                     |
| [Replicated Embedded Cluster v3](https://docs.replicated.com/embedded-cluster/v3/embedded-overview) | One application-specific binary installs k0s, storage, registry, and the app through a UI or headless CLI | Host preflights, fixed stage pipeline, resumable operations, one binary per app version, support bundles, air-gap and multi-node paths | v3 is beta and has no disaster recovery; it adds a commercial distribution and telemetry contract; k0s does not match the currently tested Compartment cluster shape                                     |
| [kURL](https://kurl.sh/docs/install-with-kurl)                                                      | Generated, versioned installer composes kubeadm and add-ons; online, HA, and air-gap modes                | Immutable component manifest, exact versions, rerun-to-upgrade, air-gap bundle                                                         | Large kubeadm/add-on lifecycle, more components than Compartment needs, and a second installer architecture to own                                                                                       |
| [k0s](https://docs.k0sproject.io/latest/install/)                                                   | Single binary plus system service                                                                         | Clean binary/service lifecycle, preflight command, reset command                                                                       | Ingress and storage are separate work; changing distro would invalidate the current k3s release evidence                                                                                                 |
| [RKE2](https://docs.rke2.io/install/quickstart)                                                     | Installer plus explicit service enable/start                                                              | Strong service layout, cleanup scripts, multi-node join token                                                                          | More host prerequisites and operational weight than a single-VM product needs; no current Compartment compatibility gate                                                                                 |
| [MicroK8s](https://canonical.com/microk8s/docs/setting-snap-channel)                                | Snap package and opt-in add-ons                                                                           | Simple version channels and rollback through snap revisions                                                                            | Patch updates happen through snap refresh unless held; add-ons have a separate upgrade lifecycle; requires snapd                                                                                         |

### Conclusions from the research

1. The winning first-run UX is one obvious command, but `curl | sudo bash` is not the security model to copy. Download and verify the Compartment CLI as the invoking user, show the mutation plan, then elevate the verified binary for the host-changing phase.
2. Preflight must be a first-class product surface, not a list in documentation. Replicated's split between host preflights and application preflights is the right model.
3. The installer needs durable stages and safe retry. “Run the script again” is useful only when the installer can distinguish its own partial installation from unrelated host state.
4. First-owner creation must stay inside the authenticated install-token flow. Do not expose an unauthenticated public registration race like the Docker PaaS installers do.
5. Compatibility should not pin one distribution patch, but an individual privileged installation must still download verified artifacts and record what it installed.
6. The initial support promise should be narrow. Broad distro support before an OS-by-OS firewall, kernel, storage, and upgrade matrix exists turns installation failures into customer debugging.

## Product contract

### Supported v1 target

- One fresh Ubuntu 24.04 LTS VM.
- `x86_64` only until the complete arm64 image and fresh-VM e2e matrix is green.
- systemd, cgroup v2, root access through `sudo`.
- Single Kubernetes server that also runs workloads.
- Public IPv4 for the managed-domain happy path. IPv6-only and private/NAT-only hosts are deferred until their reachability contracts are proved.
- Hard minimum proposed for the first test gate: 2 vCPU, 4 GiB RAM, 50 GiB free SSD storage.
- Recommended: 4 vCPU, 8 GiB RAM, 80 GiB free SSD storage, because the platform includes PostgreSQL, registry, BuildKit, and application builds on the same node.
- Ports 80 and 443 available for the Compartment-owned ingress. Port 22 is never modified.

These numbers are provisional until a release-gate load test measures install peak memory, first build peak memory, disk use, and disk latency on the smallest supported VM.

### Explicit non-goals for v1

- Provisioning into a non-empty host or adopting a pre-existing k3s installation.
- Multi-node, HA, worker joins, or conversion from the single-node topology.
- Air-gapped installation.
- Arbitrary Linux distributions.
- Automatic cloud security-group, DNS-provider, or VM provisioning changes.
- Custom CNI, ingress controller, StorageClass, pod CIDR, or service CIDR.
- A second Helm chart or platform installation path.
- Silent Kubernetes auto-upgrades.

The existing-Kubernetes mode remains the answer for all of those advanced cluster choices.

## User experience

### Public happy path

```bash
curl -fsSL https://compartment.dev/install.sh | sh -s -- --init-install
```

The bootstrap continues to install and verify the signed CLI without root. The CLI selects the target without asking when the state is unambiguous:

- a fresh supported host with no usable kubeconfig selects the managed-VM path;
- a usable kubeconfig selects the existing-Kubernetes path;
- foreign or conflicting Kubernetes state stops with remediation instead of asking the user to interpret it;
- `--target vm|kubernetes` remains the explicit override and the automation contract.

Only an interactive environment where both paths are genuinely valid shows a target choice. A clean-VM happy path adds no target question.

The VM flow then runs read-only checks and shows one review:

```text
Checking this VM
  ✓ Ubuntu 24.04 LTS, x86_64, systemd
  ✓ 4 CPU, 8.0 GiB RAM, 92 GiB free
  ✓ cgroup v2, required kernel modules, synchronized clock
  ✓ ports 80 and 443 are free
  ✓ pod and service CIDRs do not conflict with host routes
  ✓ required download and registry endpoints are reachable
  ✓ public address 203.0.113.10

Installation review
  Target: this VM
  Kubernetes: k3s, current Compartment-supported release, single node, embedded etcd
  Cluster services: Flannel, NetworkPolicy, Traefik, ServiceLB, local-path storage
  Additional prerequisite: cert-manager, compatible release
  Kubernetes Secrets: encryption at rest enabled
  Public address: 203.0.113.10
  Domain: managed
  Owner: admin@example.com
  Organization: Acme

Host changes
  /usr/local/bin/compartment
  /etc/compartment/values.yaml
  /etc/rancher/k3s/config.yaml
  /var/lib/rancher/k3s
  /var/lib/compartment/installer
  systemd service: k3s

Continue and request sudo access? [y/N]
```

Only after confirmation does the verified binary re-execute its privileged provisioning subcommand through `sudo`. The bootstrap script itself never receives root.

Progress uses durable stage names:

```text
  1/8 Preparing host
  2/8 Installing k3s
  3/8 Waiting for Kubernetes
  4/8 Installing cert-manager
  5/8 Verifying cluster prerequisites
  6/8 Installing Compartment foundation
  7/8 Configuring domain and TLS
  8/8 Creating the first owner
```

Success output:

```text
Compartment is ready at https://console.<managed-domain>
Logged in as admin@example.com.

Next: run `compartment init` in an application repository.
Recovery: rerun `compartment install`; it resumes this installation safely.
Diagnostics: run `sudo compartment system diagnose`.
```

The privileged phase installs the same verified CLI at `/usr/local/bin/compartment`. The normal deployment workflow runs without `sudo`; only host and cluster operator commands require elevation.

### Automation contract

Non-interactive use must select a target explicitly:

```bash
sudo compartment install \
  --target vm \
  --managed-domain \
  --email admin@example.com \
  --organization Acme \
  --admin-password-file /run/secrets/compartment-admin-password \
  --yes
```

Rules:

- `--target vm|kubernetes` is optional only in an interactive terminal.
- `--yes` accepts the rendered mutation plan but never bypasses a failed preflight.
- Add `--admin-password-file` and stdin support; do not make a command-line password the recommended automation path because process arguments are observable.
- `compartment install --target vm --check --output json` runs every read-only host and network check, reports the selected release channel and resolved artifacts, and makes no changes.
- JSON output reports stages and final state without terminal spinners.

## Provisioned cluster shape

The release-owned configuration should start from this intent, with exact syntax finalized in Step 2:

```yaml
cluster-init: true
secrets-encryption: true
write-kubeconfig-mode: '0600'
# node-external-ip: <selected address after the reachability proof>
```

Decisions:

- Initialize embedded etcd on the first node instead of default SQLite. This enables scheduled snapshots and leaves a technically valid future path to three server nodes, without promising HA in v1.
- Keep k3s defaults for Flannel, kube-proxy, the embedded NetworkPolicy controller, CoreDNS, Traefik, ServiceLB, and local-path provisioning.
- Keep the default `10.42.0.0/16` pod and `10.43.0.0/16` service networks because the chart already projects them into BuildKit NetworkPolicy values. A route conflict is a blocking preflight in v1, not an invitation to create another configuration branch.
- Make the reviewed public address the canonical ingress endpoint. Set k3s `node-external-ip` only after Step 1 proves the direct-address and NAT cases; never let a guessed address enter ServiceLB status or managed-domain allocation.
- Enable Kubernetes Secret encryption at rest because Compartment owns this cluster and already documents it as the BYO operator's responsibility.
- Use embedded-etcd scheduled compressed snapshots with an explicit retention policy. Local snapshots are recovery from operator error, not machine-loss backup; off-host backup remains a separate operator decision.
- Do not install Docker. k3s owns containerd; BuildKit remains the product build path.
- Supply a verified Helm CLI compatible with the canonical installer. A clean k3s host does not include `helm`, while the installer invokes it directly.
- Create a dedicated private-registry CA and cert-manager issuer, install the CA into the node trust store, and restart k3s before the platform install. This is provisioner-owned state, not a user prerequisite.
- Install a cert-manager release compatible with the supported Kubernetes window and wait for CRDs, controller, webhook, and cainjector before calling the canonical installer.

## Artifact and privilege model

The signed CLI release contains provisioning metadata that resolves its tested release channels to verified artifacts:

```text
k3s channel and resolved version
k3s release URL and sha256
upstream installer source URL and sha256, if the upstream installer is used
cert-manager version, manifest URL, and sha256
Helm version, archive URL, and sha256
expected bundled component versions
supported OS image identifiers and architecture
pod and service CIDRs
```

Requirements:

- Never download an unbounded `latest` artifact during customer installation.
- Never pipe the mutable upstream k3s installer directly into a root shell.
- Download into a private temporary directory, verify before execution, and remove the directory on exit.
- Prefer a version-tagged upstream install script with a digest embedded in the signed Compartment CLI. If that cannot be made reproducible, install the verified k3s binary and audited systemd unit directly.
- Log URLs, versions, digests, stages, and command exit status; redact tokens, passwords, kubeconfig credentials, certificate keys, and broker credentials.
- The public bootstrap's existing signed OCI verification remains the root of trust for the provisioning metadata.

## Preflight contract

Preflight is read-only. It must finish before domain allocation, file writes, package installation, or firewall mutation.

### Host checks

- Exact OS ID and version, architecture, init system, kernel, cgroup mode, and required kernel modules.
- CPU, memory, free bytes and percentage, filesystem type, inode availability, and a bounded disk-latency probe.
- Clock synchronization and valid hostname.
- Root or working `sudo` escalation path.
- Ports required by k3s and Compartment, with the owning process named on conflict.
- Default pod and service CIDRs absent from routes and interfaces.
- No foreign Kubernetes, k3s, container runtime, CNI state, or Compartment provisioner state.
- Host firewall detected and classified; no blanket `ufw disable` or `systemctl disable firewalld` action.
- The selected public interface and cluster-only listeners are identified before k3s starts. The mutation review must show the persistent rules that block etcd, Kubernetes API, kubelet, and overlay ports from that interface.

### Network checks

- DNS resolution and HTTPS reachability for the Compartment release endpoints, GitHub release assets, GHCR, the selected cert-manager image registries, ACME endpoints, and the managed-domain broker when selected.
- Candidate public IPv4 determined from both local interface inventory and a Compartment-controlled observation endpoint.
- If the two observations disagree because of NAT, show both and require an explicit choice; do not silently copy Dokploy's public-IP fallback behavior.
- After ingress starts, the broker performs an inbound 80/443 reachability challenge before domain reservation and ACME. A cloud firewall failure produces provider-neutral instructions and a retry command.

### Existing-state classification

| Observed state                                                         | Result                                                     |
| ---------------------------------------------------------------------- | ---------------------------------------------------------- |
| No provisioner state and no Kubernetes state                           | Fresh install                                              |
| Matching Compartment provisioner state and matching k3s config/version | Resume                                                     |
| Compartment state with a known incomplete stage                        | Resume from that stage after revalidation                  |
| k3s/Kubernetes exists without Compartment provisioner ownership        | Stop; use `--target kubernetes` or clean the VM explicitly |
| Provisioner state exists but version/config ownership is inconsistent  | Stop with a diagnosis and repair command                   |
| Another process holds the provisioner lock                             | Stop and report its PID/start time                         |

No path adopts or overwrites a foreign cluster.

## Durable state and retry

Host state lives under `/var/lib/compartment/installer` and contains no credentials:

```text
installation format version
provisioning metadata digest
selected target and topology
completed stage
k3s version and owned config digest
cert-manager version
kube context
install start/update timestamps
last failure stage and redacted message
```

The provisioner also persists the generated, non-secret operator values at `/etc/compartment/values.yaml` with root-only permissions. Owned-host lifecycle commands resolve this path automatically. This is required because the current canonical update service needs the operator values file, while today's interactive installer deletes its temporary material after installation. Secret values remain in Kubernetes Secrets and never enter this file.

Rules:

- Protect mutation with a host-level lock.
- Write state atomically after each successful stage.
- Revalidate the completed stage before skipping it on retry.
- A signal or failure leaves the cluster in place and prints the exact rerun command.
- Never auto-uninstall after a later stage fails; the existing Helm retained-state protocol must remain recoverable.
- Do not duplicate domain allocation, registry setup, owner bootstrap, or Helm stage state in the host state file.

## Firewall and exposure decision

This is a required proof, not an implementation detail.

- Publicly expose only 80 and 443 for the product path.
- Do not assume a provider firewall protects the Kubernetes API, etcd, kubelet, or the Flannel VXLAN port.
- Prove a configuration that keeps the Kubernetes API and cluster-only ports unreachable from the public interface while preserving local k3s operation and the managed-domain path.
- If the supported implementation edits UFW/nftables, render every exact rule in the review, tag only Compartment-owned rules, and remove only those tagged rules during destructive reset.
- Never disable the host firewall globally.
- Cloud security-group changes remain outside the installer; inbound reachability checks identify them before certificate issuance.

## Lifecycle contract required before GA

Owning Kubernetes means owning more than day-zero installation.

### Status and diagnostics

Extend the operator surface so the owned-host path reports both layers:

```text
compartment system status
  host provisioner
  k3s service and version
  Kubernetes node and prerequisite readiness
  Compartment Helm release and platform readiness
```

Add `sudo compartment system diagnose` to create a redacted support bundle containing host preflight results, provisioner state, systemd status/journal excerpts, k3s version/config digest, node conditions, events, prerequisite status, and Compartment workload status. It must not contain Secret values or kubeconfig credentials.

### Update

An owned installation uses one product-facing command:

```text
sudo compartment system update
```

The target release's provisioning metadata decides whether the operation changes only Compartment images or also upgrades k3s/cert-manager. The sequence is:

```text
preflight target release
-> verify all artifacts
-> create and verify an etcd snapshot
-> upgrade k3s through supported minor steps
-> verify node and cluster prerequisites
-> upgrade cert-manager when required
-> invoke the existing canonical platform update
-> verify public and registry paths
```

There are no background Kubernetes upgrades. A failed update remains resumable from durable state. Rollback claims are not allowed until a real k3s downgrade plus datastore-restore test passes.

### Removal

Default platform uninstall must not imply host destruction. Add a separately named destructive operation, for example:

```text
sudo compartment system reset --destroy-provisioned-cluster
```

It requires an interactive typed confirmation or an exact installation ID in automation. It removes only resources and host changes recorded as Compartment-owned, states that application and platform data will be lost, uses the upstream k3s reset/uninstall mechanism, and reports whether a reboot is required. It never runs automatically after an install failure.

## Repository ownership

Primary owner: `packages/cli`, consistent with `docs/layers/cli.md`.

- `install.command.ts`: add `--target vm|kubernetes`, `--check`, `--yes`, and secure password input.
- `install.command.kubernetes.ts`: remain the existing-cluster command path.
- New adjacent host-provisioning command/service files: target selection, host inventory, preflight, review, privilege re-exec, provisioning metadata, durable state, and prerequisite orchestration. Every public input/output uses named adjacent `*.types.ts` types.
- `kubernetes-install-application.service.ts`: unchanged as the canonical platform install entrypoint; the provisioner calls it after producing the owned kubeconfig and values.
- Owned-host state persists `/etc/compartment/values.yaml`; the existing-cluster path keeps its current operator-supplied or temporary values behavior.
- `install.sh` and its template: pass the target/check inputs through `--init-install`; do not add root host mutation to the shell bootstrap.
- Existing `system` lifecycle services: add the owned-host wrapper while retaining the existing Kubernetes operator implementation underneath.
- `deploy/chart/compartment`: no duplicate provisioned-mode chart and no VM-specific route.
- Public contracts change only if JSON command output becomes a documented public schema; no API or SDK route is required for local host provisioning.

## Delivery strategy

Implement the complete vertical slice on one feature branch and ship it in one pull request. The steps below are local checkpoints, not pull-request boundaries. Run narrow package checks after each checkpoint, complete the fresh-VM gate before opening the pull request, and pay the broad CI cost once.

## Implementation checkpoints

### Step 1 — disposable VM proof (completed 2026-08-03)

Before building the installer UX, manually prove the intended runtime on a disposable Ubuntu 24.04 VM. This is a short technical spike, not a product feature or a separate delivery track:

1. Install k3s from the current supported channel and validate the required Kubernetes capabilities.
2. Run the same validation against the previous supported Kubernetes minor in CI so compatibility is not inferred from one distribution build.
3. Replace the repository's exact one-version compatibility statement with the supported minor window and capability contract. Keep explicit CI versions as test inputs, not product policy.
4. Prove on the disposable VM:
   - k3s with embedded etcd and Secret encryption;
   - default Traefik, ServiceLB, Flannel, NetworkPolicy, CoreDNS, and local-path readiness;
   - cert-manager installation;
   - inbound 80/443 reachability and managed DNS/TLS;
   - private registry push and node pull;
   - API and cluster-only ports not reachable publicly;
   - reboot survival.
5. Record the installed artifacts and digests so the result is reproducible.

Stop if any proof requires a second platform contract or a VM-only Helm behavior branch.

#### Proof result — 2026-08-03

The proof ran on `compartment-dmitry-devbox-07`, a clean Ubuntu 24.04.4 VM with 8 vCPU, 15 GiB RAM, and 287 GiB initially free.

Proved:

- the release-owned tested k3s channel resolves to `v1.35.5+k3s1`; the node becomes Ready with embedded etcd, Secret encryption, Flannel, kube-proxy, NetworkPolicy enforcement, CoreDNS, Traefik, ServiceLB, and local-path storage;
- cert-manager `v1.21.0` was Ready and its required APIs and admission webhook worked on Kubernetes 1.36;
- the published canonical Kubernetes installer passed preflight, verified signed platform images, installed the platform, issued certificates, and completed its private-registry node-pull acceptance check;
- a real Dockerfile application built, pushed through the private registry, pulled by the node, reached `active` in 29 seconds, and returned the expected protected-route redirect;
- an explicit NetworkPolicy changed a reachable test Service into a blocked Service;
- etcd snapshot creation succeeded;
- after reboot, the platform, CLI session, registry trust, metrics, firewall, and deployed application returned healthy;
- the installed host used 2.3 GiB RAM and 6.2 GiB disk in total after the proof; `/var/lib/rancher/k3s` accounted for 4.1 GiB. These are observations, not minimum sizing claims.

Release blockers and required design changes found by the proof:

1. `https://compartment.dev/install.sh` served the legacy `latest` bootstrap and installed CLI `0.9.2`, which has no Kubernetes channel or Kubernetes installation options. The current repository-rendered bootstrap worked, but the branch-tip Kubernetes artifact was not yet published and it fell back to the last signed build. The public bootstrap handoff must be a release gate.
2. Default single-node k3s exposed etcd `2379/2380`, the Kubernetes API `6443`, kubelet `10250`, and Flannel VXLAN `8472` on the public interface. A persistent nftables proof rule blocked those ports without breaking ingress, NetworkPolicy, registry pull, deploy, or reboot. The product implementation needs an owned, provider-independent firewall primitive applied before k3s starts.
3. A clean k3s host had no Helm CLI. The provisioner must supply it or replace the subprocess dependency; the customer cannot be asked to install it.
4. The private registry path required a dedicated CA issuer and node-runtime trust. Installing the CA into the host trust store before restarting k3s made the canonical node-pull proof pass. The provisioner must own CA creation, rotation, trust installation, and removal.
5. An operator-owned `sslip.io` domain with a public ACME HTTP-01 issuer could issue the exact console certificate but not the required wildcard certificate. The VM happy path should remain the managed-domain broker DNS-01 path. Operator-owned domains need an existing DNS-01 issuer or wildcard Secret and are not the zero-configuration path.
6. Managed-domain DNS-01 was not exercised because reservation authorization is intentionally available only through the public onboarding flow, which was blocked by the stale public bootstrap. A fresh-VM release gate with the real broker remains mandatory.
7. `k3s etcd-snapshot` succeeds but prints warnings for server-only keys in the shared k3s config file. Lifecycle commands should suppress or avoid this misleading operator noise without hiding real snapshot failures.

### Step 2 — read-only host preflight and UX

- Resolve the target from kubeconfig and host state before entering either install path; prompt only when both paths are genuinely valid.
- Implement host/network inventory, exact failures, `--check`, JSON output, and the mutation review.
- Add tests for OS parsing, routes/CIDRs, port ownership, public-address disagreement, and foreign-state classification.
- No host writes in this step.

### Step 3 — privileged, resumable cluster provisioning

- Re-execute the verified binary through `sudo` after review.
- Install a system-wide CLI copy, durable state, lock, persistent cluster-port firewall, channel-selected k3s, owned config, Helm, cert-manager, and private-registry CA trust.
- Generate the owned kubeconfig and call `installIntoKubernetes(input)`.
- Fault-inject after every durable stage and prove that the same command resumes one installation identity.

### Step 4 — public ingress and first-owner completion

- Implement the broker-backed inbound reachability gate.
- Complete managed-domain/TLS installation through the existing state machine.
- Preserve the current install-token owner bootstrap and saved user session under `SUDO_USER`; never expose a public first-user registration page.
- Verify a first CLI login and first application deployment.

### Step 5 — owned-host lifecycle

- Composite status and redacted diagnostics bundle.
- Explicit update state machine with pre-update etcd snapshot and N-1 to N test.
- Explicit destructive reset with ownership checks.
- Public operator documentation for reboot, backup limitations, update, recovery, and removal.

### Step 6 — release gates and publication

- Fresh-VM release gate on Ubuntu 24.04, not a container and not k3d.
- Public managed-domain/TLS gate on an ephemeral VM with a real inbound address.
- Install interruption matrix, rerun, reboot, update, and destructive reset.
- Verify the current and previous supported Kubernetes minors for both provisioned and existing-cluster paths.
- Publish the supported Kubernetes minor window, required capabilities, host, architecture, resource, and port matrix; do not publish one k3s patch as the compatibility contract.
- Record p50/p95 install time and peak memory/disk use. Proposed acceptance budget: ready control plane within 10 minutes on the minimum supported VM.

## Acceptance criteria

- The one-line public bootstrap can complete a supported fresh-VM install without the user installing or configuring Kubernetes prerequisites.
- The public URL serves the same verified Kubernetes bootstrap that the release pipeline approved; a legacy bootstrap or unpublished branch-tip artifact blocks release.
- The bootstrap itself never runs as root; only the verified CLI performs reviewed privileged mutations.
- No mutable `latest` artifact is executed.
- Preflight detects unsupported host, resource, route, port, firewall, foreign-cluster, and reachability failures before persistent mutation where possible.
- Retry after every retained host and Helm stage converges to one installation identity and one first owner.
- The provisioned cluster passes the same canonical install, registry, workload, domain, isolation, and public-route gates as the existing-cluster path.
- Kubernetes Secrets are encrypted at rest on provisioned clusters.
- Only ports 80 and 443 are publicly reachable by design; cluster-only ports fail an external probe.
- Private-registry CA trust is installed before k3s starts, survives reboot, passes node pull, and is included in update and removal ownership.
- Reboot returns k3s, prerequisites, Compartment, and a deployed test application to readiness.
- An N-1 provisioned installation updates to N through the public lifecycle command.
- Diagnostics are useful and redacted.
- Destructive reset removes only recorded Compartment-owned host state and requires explicit confirmation.
- Existing Kubernetes installation remains canonical and does not gain VM-only behavior.

## Decisions required before the release gate

Resolve these in the same implementation branch before the final release gate; they do not block starting the vertical slice:

1. Supported Kubernetes minor window, required capability checks, and the process that advances the tested k3s channel.
2. Exact public-IP observation and inbound challenge protocol with the managed-domain broker.
3. Exact API/overlay port isolation mechanism on Ubuntu 24.04.
4. Embedded-etcd local snapshot schedule and the product wording that distinguishes it from off-host backup.
5. Whether the release can meet the minimum 4 GiB VM target during a real application build; raise the minimum rather than adding swap silently if it cannot.
6. Whether arm64 becomes part of v1 or remains experimental until an independent release gate exists.

## Sources

- [Compartment existing-Kubernetes prerequisites](../docs/existing-kubernetes-install.md)
- [Compartment existing-Kubernetes architecture and future provisioner boundary](../docs/specs/existing-kubernetes-install.md)
- [K3s quick start](https://docs.k3s.io/quick-start)
- [K3s configuration behavior](https://docs.k3s.io/installation/configuration)
- [K3s embedded-etcd topology](https://docs.k3s.io/datastore/ha-embedded)
- [K3s etcd snapshots](https://docs.k3s.io/cli/etcd-snapshot)
- [K3s local storage](https://docs.k3s.io/add-ons/storage)
- [Kubernetes patch support schedule](https://kubernetes.io/releases/patch-releases/)
- [cert-manager supported releases](https://cert-manager.io/docs/releases/)
- [Replicated Embedded Cluster v3 overview](https://docs.replicated.com/embedded-cluster/v3/embedded-overview)
- [Replicated Embedded Cluster v3 requirements](https://docs.replicated.com/embedded-cluster/v3/installing-embedded-requirements)
- [Replicated Embedded Cluster v3 install flow](https://docs.replicated.com/embedded-cluster/v3/installing-embedded)
- [kURL install flow](https://kurl.sh/docs/install-with-kurl)
- [Coolify installation](https://coolify.io/docs/get-started/installation)
- [Dokploy installation](https://docs.dokploy.com/docs/core/installation)
- [CapRover getting started](https://caprover.com/docs/get-started.html)
- [Dokku installation](https://dokku.com/docs/getting-started/installation/)
- [k0s quick start](https://docs.k0sproject.io/latest/install/)
- [RKE2 quick start](https://docs.rke2.io/install/quickstart)
- [MicroK8s version channels](https://canonical.com/microk8s/docs/setting-snap-channel)
