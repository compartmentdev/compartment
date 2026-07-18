# Docker to Kubernetes Feature Parity Audit

## Gate result

ПАРИТЕТ: НЕТ — 4 потерянных фич

This audit compares `origin/docker-legacy` at `dbf3ab6d` with `origin/kubernetes` at `dcb41449`. The comparison contains
1,225 changed files, 47,516 inserted lines, and 63,681 deleted lines. The audit classifies product behavior rather than
matching implementations by name.

The four class C findings are:

1. The public installer cannot hand off a managed-domain install through `--init-install`.
2. Kubernetes has no Compartment-owned status, restart, or verified update workflow for an installed platform.
3. The chart drops the install-wide rollback-retention setting and forces indefinite retention.
4. The chart keeps auth-throttle defaults but drops the operator tuning surface.

This PR records findings only. It does not restore any behavior.

## Method and coverage

The audit started from the complete `git diff --name-status` list. Each changed file belongs to one of these reviewed
slices:

| Slice                        |     Files | Review boundary                                                     |
| ---------------------------- | --------: | ------------------------------------------------------------------- |
| Control plane and client     |       721 | API routes, services, queries, schema, contracts, SDK, CLI, Console |
| Runtime cutover              |       303 | node, Docker engine adapters, Worker, Kubernetes runtime, Edge      |
| Shared packages              |        25 | utils, test support, lint packages                                  |
| Deploy, build, and harness   |        87 | Helm chart, e2e fixtures, deploy/release/docs scripts               |
| Documentation                |        58 | layer docs, specs, public guides, generated CLI reference           |
| CI workflows                 |         8 | k3d, image publication, security, and release workflows             |
| Repository and agent tooling |        23 | root manifests, installer, Knip, agent skills and guidance          |
| **Total**                    | **1,225** | Complete diff inventory                                             |

For each behavior, the review followed the legacy entrypoint through its service and runtime side effect. A current
contract or service counted as class A only when a production command, route, controller, chart workload, or release
workflow calls it. Test-only references did not count.

The classifications are:

- **A, ported:** the Kubernetes production path provides the behavior.
- **B, removed with the Docker model:** the behavior controlled Docker Engine, Compose, host networking, node-agent,
  or container identity and has no supported Kubernetes product equivalent.
- **C, lost:** users or operators could observe or configure the behavior in 0.9.2, and the Kubernetes production path
  neither implements nor calls an equivalent.

## Class C: lost behavior

### C1. Managed-domain `install.sh --init-install` hand-off

The Docker installer accepted `--init-install` and invoked `compartment install`, whose default mode allocated a managed
domain. The Kubernetes guide still publishes this flow with only `--init-install --values compartment-values.yaml` in
`public-docs/src/content/docs/quickstart/install-compartment.md`.

The current `install.sh` and `scripts/release/install-cli.sh.template` require both `--api-url` and `--base-domain` when
`--init-install` is set. Passing `--base-domain` makes `resolveInstallDomainMode()` select `custom`, so the installer has
no argument combination that reaches the CLI's default managed-domain path. Direct `compartment install --values ...`
works; the public bootstrap hand-off does not.

Production trace:

`install.sh` argument validation stops before `run_init_install()` -> no call to
`packages/cli/src/commands/install/install.command.ts` -> no managed allocation.

### C2. Platform status, restart, and verified update

The Docker line shipped `compartment system status`, `compartment system restart`, `compartment system update`, and
`install.sh --init-update`. The commands reported service health, restarted the installed platform, and applied a
versioned update after signature verification.

`packages/cli/src/commands/system/register-system.commands.ts` now registers only `domain` and
`issue-password-reset`. The installer removed `--init-update`, and the public CLI reference removed all three command
pages. `packages/cli/src/services/kubernetes-install.service.ts` treats an existing full release with retained state as
an owner-bootstrap resume and does not upgrade it. Operators can run `kubectl` or `helm` themselves. Those commands lack
the deleted Compartment workflow and its image-trust gate.

Production trace:

no CLI registration -> no operator service -> no Helm status, rollout restart, or verified platform upgrade.

### C3. Install-wide rollback-retention default

The Docker line exposed `COMPARTMENT_ROLLBACK_RETENTION_LIMIT` in `.env.self-hosted.example`, passed it into the API
through Compose, and documented it as the install-wide default inherited by organizations.

The API still parses and uses the setting in `packages/api/src/config.ts` and
`packages/api/src/services/rollback-retention-policy.service.ts`. The Kubernetes chart has no corresponding value or
schema field. `deploy/chart/compartment/templates/configmap.yaml` always writes
`COMPARTMENT_ROLLBACK_RETENTION_LIMIT: ""`, which means indefinite retention. Organization-level overrides remain, but
operators cannot set the inherited install default.

Production trace:

Helm values -> no rollback-retention field -> ConfigMap hard-codes empty -> API receives `null` -> inherited policy is
always indefinite.

### C4. Auth-throttle operator tuning

The Docker install env exposed the login, activation, and password-reset throttle windows, limits, and cooldowns. The
Compose production path passed all of them to API. The Kubernetes chart preserves the same default protection behavior,
but `values.yaml` and `values.schema.json` expose none of the throttle fields. The ConfigMap hard-codes all 33 values.

The API contracts and enforcement remain live in `packages/api/src/config.ts` and the auth throttle services. The
operator configuration path is gone.

Production trace:

Helm values -> no throttle fields -> ConfigMap constants -> API enforcement uses fixed defaults.

## Class A: ported behavior

| ID  | Legacy behavior                                                                                                                                   | Kubernetes production path                                                                                                                                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | CLI auth, remotes, organization context, users, groups, roles, assignments, SSO, variables, audit, projects, app domains, and Git-source commands | Command registrations remain under `packages/cli/src/commands/`; the protected API route families remain registered under `packages/api/src/routes/`. Runtime-independent contract changes are type or presentation changes.                                                                      |
| A2  | Production install creates platform services and persistent state                                                                                 | `install.command.ts` -> `kubernetes-install.service.ts` -> `kubernetes-install-helm.service.ts` -> `deploy/chart/compartment/templates/`. The chart creates API, Worker, Edge, Caddy, PostgreSQL, registry, BuildKit, migrations, Secrets, and PVCs.                                              |
| A3  | First owner and organization bootstrap                                                                                                            | `kubernetes-install.service.ts` waits for the public endpoint, then `install.command.ts` calls `installKubernetesOwner()` -> authenticated `/v1/install`. `post-install.route.ts` verifies the retained install token before calling the install service.                                         |
| A4  | Retryable install identity                                                                                                                        | `kubernetes-install-retained-state.service.ts`, `kubernetes-install-release.service.ts`, and `install-state-secret.yaml` reuse installation ID, token, domain allocation, ingress, and generation across retries.                                                                                 |
| A5  | Managed-domain broker allocation                                                                                                                  | `kubernetes-install-state.service.ts` resolves the LoadBalancer ingress and calls `allocateInstallManagedDomain()` through SDK. The result is persisted in the retained install-state Secret.                                                                                                     |
| A6  | Managed ACME DNS-01                                                                                                                               | `Caddyfile.managed` loads the broker DNS module; `caddy.yaml` injects the scoped broker token from the retained Secret. Browser TLS terminates on the customer cluster.                                                                                                                           |
| A7  | Public HTTP and HTTPS ingress                                                                                                                     | `caddy.yaml` creates the public Service with ports from `service.caddy.httpPort` and `httpsPort`, defaulting to 80 and 443. API, Edge, registry, BuildKit, health, and internal-token routes stay internal.                                                                                       |
| A8  | Operator-owned domain and external TLS origin                                                                                                     | `--base-domain` selects the custom install path. Chart `custom-http` replaces the Docker `external` mode while preserving public HTTPS with an HTTP origin behind the operator load balancer.                                                                                                     |
| A9  | System-domain stage, status, verify, activate, and managed reset                                                                                  | `system/domain.command.ts` -> `kubernetes-system-domain.service.ts` -> `kubectl exec` private system API -> API domain services. Activation and reset call `kubernetes-system-domain-release.service.ts` for the Helm release.                                                                    |
| A10 | Custom certificate material                                                                                                                       | `attach-cert` validates local PEM material, creates an operation-scoped Kubernetes TLS Secret, and mounts it in API. Activation promotes the material through `custom-tls-secret.yaml` and mounts it read-only in API and Caddy.                                                                  |
| A11 | Operator password recovery                                                                                                                        | `system/issue-password-reset.command.ts` -> `kubernetes-password-recovery.service.ts` -> `kubectl exec` into API -> the private system API. Caddy exposes no recovery route.                                                                                                                      |
| A12 | Platform image trust                                                                                                                              | `kubernetes-install-material.service.ts` calls `kubernetes-image-trust.service.ts` before Helm. The service verifies API, Worker, Edge, and Caddy images with cosign, resolves immutable digests, and writes the trust values passed to Helm. Domain-triggered Helm activation repeats the check. |
| A13 | GitHub account discovery for managed installs                                                                                                     | Public source routes register `source-git-account-discovery.route.ts`; the service calls the configured broker adapter. The chart passes the managed broker URL and retained token to API.                                                                                                        |
| A14 | Build source archives into reusable images                                                                                                        | Worker claims the deployment, reads the source archive, builds through the cluster BuildKit Service, pushes through registry auth, and requires a digest-pinned result before hand-off.                                                                                                           |
| A15 | Build isolation and cleanup                                                                                                                       | `buildkit.yaml`, `buildkit-network-policy.yaml`, registry network policy, rootless BuildKit storage, and the prune CronJob replace the Compose builder and its network.                                                                                                                           |
| A16 | Release commands before app activation                                                                                                            | Deployment reconcile creates a durable product Job from the release intent, waits for its result, then applies the application manifests.                                                                                                                                                         |
| A17 | App command, env, ports, readiness, routes, and immutable image                                                                                   | `kube-application-projection` and `kube-projections` map deployment intent to Deployment, Service, Secret, and NetworkPolicy objects. The controller uses the digest-pinned image from the Worker hand-off.                                                                                       |
| A18 | Rolling deployment with rollback on failed readiness                                                                                              | `worker-deployment-reconcile.service.ts` applies the candidate, observes Deployment readiness, commits the route/state transition through the API, and reapplies the saved active manifest on failure.                                                                                            |
| A19 | Deployment stop, project stop/start, archive, and delete cleanup                                                                                  | API lifecycle services resolve persisted Kubernetes membership and call the Kubernetes stop/reconcile paths. Project deletion also removes project resources and provisioning state.                                                                                                              |
| A20 | Published app routing and access gating                                                                                                           | API persists active route ownership; Edge consumes access snapshots; Caddy sends app traffic to Edge. `packages/edge/src/` keeps browser access exchange and host-bound session behavior.                                                                                                         |
| A21 | Deployment inspect                                                                                                                                | `deployment-inspect.service.ts` reads the persisted Kubernetes namespace and Service reference and returns Kubernetes runtime endpoints instead of node/container details.                                                                                                                        |
| A22 | Deployment and release logs                                                                                                                       | Vector in `product-log-agent.yaml` sends workload logs to the authenticated ingest route. API stores durable product logs and merges them with release Job and Compartment events for the existing logs endpoints.                                                                                |
| A23 | Deployment metrics                                                                                                                                | Worker collects Pod metrics through the Kubernetes runtime and publishes snapshots to API; the deployment metrics route and SDK expose them to Console.                                                                                                                                           |
| A24 | Durable Edge routing snapshot                                                                                                                     | Edge persists and reloads the last-known-good access snapshot on its PVC when enabled, preserving routing during API outages.                                                                                                                                                                     |
| A25 | Stateful resource declaration and stable internal connectivity                                                                                    | API persists resource intent; Worker and kube-runtime reconcile a Deployment, headless Service, Secret, and immutable-ID DNS name. `${resource.host}` resolves through `kubeResourceServiceDns()`.                                                                                                |
| A26 | Resource volumes with data-preserving updates                                                                                                     | The explicit `resource bootstrap` path creates PVCs. Later reconcile verifies claim UID/resourceVersion, stops the Pod, applies the replacement, and restores the previous executable manifest on failure without replacing storage.                                                              |
| A27 | Resource start, stop, inspect, readiness, logs, and delete                                                                                        | Existing public routes call Kubernetes resource services. Worker observes readiness and deletion settlement; resource logs come from the Kubernetes runtime.                                                                                                                                      |
| A28 | Generated resource variables, outputs, and service connections                                                                                    | Existing API resolution remains in use. Kubernetes resource DNS feeds `${resource.host}`, and deployment env projection receives resolved output bindings.                                                                                                                                        |
| A29 | Manual and scheduled backup/restore, retention, and restore-as                                                                                    | API creates durable product-job intents; Worker runs Kubernetes Jobs with the resource and backup PVCs. API verifies artifact checksum/size, records runs, prunes retention, and supports in-place and new-resource restore.                                                                      |
| A30 | Deployment rollback and reusable-image retention                                                                                                  | Rollback still queues a deployment from a retained digest. API retention cleanup deletes registry manifests after the effective organization policy permits it. C3 covers only the missing install-wide default knob.                                                                             |
| A31 | Namespace provisioning, RBAC, and network isolation                                                                                               | Project provisioning creates an immutable-ID Namespace and scoped service accounts/bindings. Admission policy and network policies constrain project controllers, build traffic, registry traffic, and DNS.                                                                                       |
| A32 | Audit retention and NDJSON sink                                                                                                                   | Chart values pass audit retention and file-sink settings. API writes the sink under the API PVC and runs scheduled bounded database cleanup.                                                                                                                                                      |
| A33 | Session TTL, trusted outbound hosts, source archive size, log level, Worker poll interval, and audit controls                                     | Each legacy operator setting has a chart value and ConfigMap mapping. C3 and C4 list the settings that lack mappings.                                                                                                                                                                             |
| A34 | Database-backed deployment recovery                                                                                                               | Durable deployment reconcile, product-job, project-provisioning, resource-reconcile, product-log, and Pod-metric tables replace node registration and in-memory container recovery. Worker controllers resume claims from API state.                                                              |
| A35 | Release images, SBOM/provenance/signing, CLI SEA, and bundled chart                                                                               | Publish workflows still build and sign the platform images and CLI. The CLI release embeds the matching chart and cosign policy; source builds require `--chart`.                                                                                                                                 |
| A36 | Production documentation and end-to-end protection for restored flows                                                                             | The quickstart and generated command reference cover Kubernetes install/domain/recovery. `_platform-k3d-e2e.yml` runs image trust, managed install, operator docs assertions, domain operations, and protected user flows. C1 records the installer case that this protection missed.             |

## Confirmation of the ten restored groups

These rows confirm production invocation, not code presence alone.

| Restored group                    | Production invocation evidence                                                                      | Result                                                           |
| --------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Install and owner bootstrap       | CLI staged Helm install -> public readiness -> authenticated `/v1/install` -> persisted CLI session | Confirmed for direct CLI; C1 is a residual installer-wrapper gap |
| Managed-domain broker allocation  | Foundation Service observation -> SDK broker request -> retained Secret -> full Helm stage          | Confirmed                                                        |
| Managed ACME DNS-01               | Caddy managed config -> broker DNS module -> token from retained Secret                             | Confirmed                                                        |
| GitHub account discovery          | Registered source routes -> API discovery service -> broker adapter using chart config              | Confirmed                                                        |
| Public ingress 80/443             | Public Caddy Service renders 80/443 and targets internal Caddy ports                                | Confirmed                                                        |
| System-domain lifecycle           | CLI system domain commands -> private pod exec -> API operation -> Helm activation/reset            | Confirmed                                                        |
| Custom certificate material       | CLI PEM read -> operation Secret -> API validation mount -> active Caddy/API Secret                 | Confirmed                                                        |
| Operator password recovery        | CLI command -> private pod exec -> API password-reset issue service                                 | Confirmed                                                        |
| Cryptographic image trust         | Install/domain Helm paths -> cosign verification -> immutable digest values -> chart                | Confirmed                                                        |
| Documentation and test protection | Public guides, generated CLI pages, chart assertions, and managed k3d suite run in CI               | Confirmed with the C1 coverage exception                         |

## Class B: behavior removed with the Docker model

| ID  | Removed behavior                                                                                                              | Reason it is not a lost Kubernetes product feature                                                                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Docker Engine client, container create/update/rename, labels, inspect, stop, and raw log buffer                               | Kubernetes Deployments, Pods, Jobs, Services, and API-backed logs own these effects. Container identity is no longer a product selector.                                                                  |
| B2  | Host node-agent process, Unix socket, registration, node health route, and node version contract                              | Kubernetes API transport and controller service accounts replace the single-host agent. The product does not expose node placement in v0.                                                                 |
| B3  | Per-project Docker bridges, subnet reservation, endpoint capacity, iptables/nftables egress, and Caddy network attachment     | Namespace, Service DNS, NetworkPolicy, RBAC, and admission policy replace host bridge management.                                                                                                         |
| B4  | Host application port range and upstream host/port allocation                                                                 | Kubernetes Services select Pods without host port allocation. Public routes point at stable Services.                                                                                                     |
| B5  | Compose files, `.env.self-hosted`, install directories, ownership repair, sudo rerun, systemd unit, and host backup paths     | Helm, Secrets, ConfigMaps, PVCs, service accounts, and Pod security contexts own this state. Product backup semantics moved to Jobs and PVCs under A29.                                                   |
| B6  | Docker namespace, runtime UID/GID group, Docker work directory, runtime probe image, and connectivity mode                    | These values described the deleted host/container topology. Chart security and Kubernetes networking set their replacements.                                                                              |
| B7  | Raw container identifiers, resource hostname, node placement, and Docker restart policy in public summaries                   | Kubernetes uses persisted immutable workload references. Resource connectivity remains available through outputs; raw runtime identity no longer forms a supported contract.                              |
| B8  | User-authored `run.restart` and resource `restart` policies                                                                   | Kubernetes Deployment controllers own process recovery and cannot represent the three Docker policies or per-service max retries. Durable product jobs own Job retry policy.                              |
| B9  | Docker candidate/start/readiness/route-switch/drain step names                                                                | Kubernetes performs rollout and route activation through one Deployment reconcile. The product keeps release progress, readiness failure, and rollback outcomes without exposing Docker container phases. |
| B10 | Local Docker image source, Docker Hub/GHCR selector, packaged node-agent version coupling, and `--local-runtime`              | Kubernetes installation selects repositories/tags in values, verifies images, and passes digests. Repository development uses k3d or `install --dev`; no host Docker production mode remains.             |
| B11 | Public port occupancy probes and CLI port flags                                                                               | The Kubernetes Service and cluster load balancer allocate ingress. Operators select Service ports and NodePorts in values.                                                                                |
| B12 | Docker resource volume names and filesystem artifact IDs                                                                      | PVC identity and per-resource artifact claims replace Docker volume names and host artifact paths while preserving the product operations in A26 and A29.                                                 |
| B13 | Docker-specific system API contracts and SDK clients for node deploy, drain, release, network reconcile, and resource control | Worker controllers call Kubernetes reconcile, product-job, and provisioning contracts. No public client used the node-internal endpoints.                                                                 |
| B14 | Legacy plain-HTTP and Docker external-TLS runtime details                                                                     | Production browser flows remain HTTPS. `custom-http` represents external TLS termination; reserved localhost HTTP remains a development-only chart path.                                                  |

## Structural cleanup candidates

The audit found these candidates while tracing runtime behavior. They are not parity findings, and this PR changes none
of them.

1. **Worker Kubernetes runtime foundation:** project provisioning crosses
   `project-provisioning.service.ts`, internal route/contract/SDK pairs, `project-provisioner.ts`,
   `project-provisioning-execution.service.ts`, and kube-runtime provisioning helpers. The same immutable identity and
   completion state pass through many forwarding layers.
2. **Stateful resource lifecycle:** reconcile spans API intent, lock, run, wait, completion and deletion query modules,
   several API services, SDK routes, Worker observation/wait/delete services, and kube-runtime projections. Review a
   package-owned state-machine boundary before adding another transition file.
3. **Durable product observability:** product log ingest, storage, retention, release-log merge, Vector configuration,
   Pod metrics publication, and the 351-line product-log gate repeat workload-selection and time-window concepts.
4. **Durable product jobs:** intent, claim, wait, finalize, result persistence, SDK forwarding, and Worker execution
   spread one lifecycle across contracts, API, SDK, and Worker. Several modules contain one-function transport steps.
5. **Cluster build pipeline:** build scheduling, BuildKit address/auth, registry auth, digest validation, cache locking,
   pruning, and k3d image import live across Worker, Docker build helpers, chart templates, and deploy scripts. The
   958-line `platform-k3d-e2e.mjs` duplicates orchestration details from the production path.
6. **Rolling deployments:** prepare/read/route/transition/audit queries plus API service, SDK, Worker reconcile, rollout
   observation, and kube-runtime status calculation form a long hand-off chain. `deployment-reconcile-transition.query.ts`
   carries several state transitions and audit writes in one 260-line module.
7. **Reconcile hardening:** `project-provisioner-rbac.yaml` embeds long admission expressions, `_helpers.tpl` has 414
   lines of install-state and validation logic, and `render_test.yaml` has 1,786 lines. Split by security invariant or
   rendered resource, keeping chart ownership intact.
8. **Gate harness concentration:** `platform-k3d-e2e.mjs`, `secure-self-hosted-images.mjs`, and the chart render test are
   the largest files in their areas. Extract pure plans and keep command execution in a thin harness.

## Final verdict

ПАРИТЕТ: НЕТ — 4 потерянных фич
