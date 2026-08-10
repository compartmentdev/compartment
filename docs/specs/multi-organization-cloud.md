# Multi-Organization Cloud

Status: proposal (research complete, no implementation). Scope: what it takes to run a hosted
Compartment cloud where many mutually-untrusting organizations live on shared infrastructure.

## Verdict

Multi-organization is already the shipped domain model, not a missing feature. Organizations,
memberships, permission-key RBAC, per-org SSO OIDC, per-org auth settings and retention policy,
org-scoped console routing (`/orgs/:slug/...`), CLI org commands, per-request org enforcement,
per-org hourly usage metering, and cross-org security tests all exist on `main` today.

What Compartment does **not** have is a tenancy layer _above_ organizations. The product is built
as "one installation = one trusting company that may use several orgs". A hosted cloud flips the
trust assumption: organizations become strangers sharing one installation. The work is therefore
not "add orgs" but six programs:

1. Self-serve identity: org creation without an existing-admin gate (V1 answers this from the
   CLI, with no mail transport at all — see G1).
2. Tenant namespacing of the remaining installation-global resources (hostnames first).
3. Hostile-tenant isolation hardening (build credentials, network policy, quotas, rate limits).
4. Billing on top of the already-shipped (write-only) usage metering.
5. Platform-operator plane: staff roles, abuse controls, org lifecycle, installation-scoped audit.
6. Scale-out of single-instance assumptions (edge snapshot, Postgres-as-blob-store, build queue).

## What already exists (do not re-plan)

| Area                                                                                                                                                                                                                                                                   | Evidence                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Org entity with per-org policy knobs                                                                                                                                                                                                                                   | `packages/api/src/db/schema-core.ts:16` (`organizations`: slug, `local_password_enabled`, rollback/audit retention)                                                                   |
| Membership + RBAC (34 permission keys, 4 system roles, groups, scoped assignments, last-admin invariant)                                                                                                                                                               | `packages/api/src/db/schema-access.ts`, `packages/contracts/src/contracts/access.contract.constants.ts`, `packages/api/src/services/rbac-admin-invariant.service.ts`                  |
| Per-request org enforcement (header → membership → session policy → permission), with an `onRoute` guard that forbids registering an org route without declaring an access mode                                                                                        | `packages/api/src/routes/protected/current-organization-route.ts`, `authorize-request.ts`                                                                                             |
| Per-org SSO OIDC + per-org login-method policy + login discovery with org selection                                                                                                                                                                                    | `packages/api/src/services/sso-oidc/*`, `organization-auth-settings.service.ts`, `browser-login-flow.service.ts`                                                                      |
| Org-scoped console IA (`/orgs/:slug/{projects,users,groups,roles,audit}`)                                                                                                                                                                                              | `packages/contracts/src/contracts/control-plane-browser-routes.contract.ts`                                                                                                           |
| CLI multi-remote + org context (`org create/list/use/settings`)                                                                                                                                                                                                        | `packages/cli/src/commands/organizations/`, `packages/cli/src/store/config.types.ts`                                                                                                  |
| Cross-org invitations, blocked memberships, session revocation propagation to edge                                                                                                                                                                                     | `packages/api/src/services/organization-users-invitation.service.ts`, `auth-session-revocation.service.ts`; tests `packages/api/test/api.auth-cross-org-security.integration.test.ts` |
| Per-org hourly usage ledger (CPU-seconds, byte-seconds, edge traffic, build/release job seconds), 400-day retention                                                                                                                                                    | `packages/api/src/db/schema-kube-runtime.ts:78` (`workload_usage_hourly`, `job_usage_hourly`), `packages/api/src/services/usage-metering.service.ts`                                  |
| Runtime isolation baseline: namespace per project, PSA `restricted`, gVisor for all tenant code, default-deny NetworkPolicy, no SA tokens, per-project ResourceQuota/LimitRange, HMAC-scoped registry credentials, fail-closed ValidatingAdmissionPolicy on build Jobs | `packages/kube-runtime/src/kube-provisioning.ts`, `kube-network-policy-projection.ts`, `kube-resource-quota-projection.ts`, `deploy/chart/compartment/templates/buildkit.yaml`        |
| Per-org domain allocation template: the managed-domain broker already derives `<label>.<zone>` from the first org's slug, with DNS-01 delegation                                                                                                                       | `packages/cli/src/services/managed-domain-label.service.ts`, `packages/contracts/src/contracts/managed-domain.contract.ts`, `packages/managed-domain-dns01-solver/`                   |
| Custom domains with DNS ownership verification, globally unique, cannot be claimed twice                                                                                                                                                                               | `docs/specs/app-custom-domains.md`, `packages/api/src/db/schema-deploy.ts`                                                                                                            |
| HA for the stateless tier proven in e2e (api/edge/caddy at 2 replicas, worker leader failover)                                                                                                                                                                         | `packages/cli/test/platform-k3d-ha.e2e.test.ts`                                                                                                                                       |

## Two product shapes

**Shape A — shared multi-tenant cloud.** One control plane + shared clusters; organizations are
the tenants. This is the direction the codebase already leans (org-scoped everything, org-keyed
metering, org isolation labels in kube-runtime). Cheapest per tenant, one fleet to operate, and
the only shape with a viable free tier. Requires the isolation-hardening program below.

**Shape B — managed dedicated installs.** The cloud provisions one full installation (control
plane + cluster or VM) per customer. The pieces mostly exist: `compartment install` managed-VM
mode, the broker's per-installation (org-slug-derived) domain allocation, signed image channels.
Isolation is trivially strong; cost per tenant is high; fleet operations (upgrades across N
installs) become the product. No free tier is economical.

Recommendation: build Shape A as _the_ cloud; keep Shape B as a later "dedicated" tier that
reuses the same installer. Do not fork the topology (the same rule
`docs/specs/existing-kubernetes-install.md` already enforces for install modes). The rest of this
document plans Shape A.

## Gap analysis

### G1. Identity, signup, onboarding

- **No self-serve path. (RESOLVED — V1 item 5.)** `POST /v1/organizations` requires being an
  admin of some visible org
  (`packages/api/src/routes/organizations/post-create-organization.route.ts:39`); the first org
  is minted only by the one-shot `POST /v1/install` guarded by a static install token. The
  answer is a CLI-only `POST /auth/signup` that mints principal, first org, and session
  together, behind an env flag that is off for self-hosted installs. The org-creation quota
  survives as a need; the "email + verification" half was struck (next bullet).
- **No email delivery anywhere — and V1 keeps it that way.** Invitations are copy-paste
  activation URLs surfaced to the inviting admin
  (`packages/console/src/features/users/user-invitation.tsx`); password reset and verification
  have no transport. This was originally read as a prerequisite for signup. It is not: the
  target user is an agent, which cannot read an inbox, so signup verifies nothing and email
  degrades to a bare identifier. A mail subsystem stays a prerequisite for invites at scale
  and billing notices, both of which are past V1.

  The consequence to accept knowingly: **there is no self-service password recovery.** Reset
  issuance is admin-only (`/organizations/.../users/{id}/password-reset` and the system API);
  no unauthenticated "forgot password" route exists. A locked-out cloud user is a manual
  ticket. Tolerable precisely because the hosting is disposable — but it stops being tolerable
  the moment a human keeps anything they care about in one of these orgs.

- **Global identity is a decision, not an accident.** `principals.email` is unique per
  installation with one password per principal across orgs (`local_credentials` keyed by
  principal). For a cloud this is the "one account, many orgs" model (GitHub-style) — keep it,
  but state it, and close the implicit account-linking at invite time (org A inviting
  `bob@x.com` silently attaches to the principal org B created).
- **Org slugs are first-come installation-wide** and derived from names
  (`organization-slug.service.ts`); public signup turns this into squatting. Needs a reserved
  list, rename/release policy, and abuse review.
- **Single-org fast paths** in login must go: `browser-login-flow.service.ts:130` branches on
  `countOrganizations() !== 1` and enumerates all orgs; `password-reset-issue.service.ts`
  (`requireSystemPasswordResetOrganization`) throws unless the principal has exactly one org.

### G2. Tenant namespacing of installation-global resources

- **App hostnames have no org segment.** `buildCanonicalAppLabel`
  (`packages/api/src/services/public-hosts.service.ts:87`) uses only
  `[serviceName, projectName, environmentName]`; `deployment_routes.subdomain` is globally
  unique. Across orgs this is first-come-first-served (`api.<zone>` to the first org, hash
  suffix to everyone else), leaks other tenants' project names, and is a phishing surface on a
  shared wildcard cert. Fix: per-org host namespace — either `<label>.<org>.<zone>` (matches
  what the broker already allocates, one wildcard cert per org) or an org segment inside the
  label. Decision D3 below.
- **`git_provider_registrations` has no `organization_id`.** Uniqueness is
  `(provider_type, provider_host, repository_owner)` installation-wide, and org attribution is a
  substring match over the stored webhook URL
  (`packages/api/src/queries/git-provider-registration-scope.query.helpers.ts`). Two orgs cannot
  both connect GitHub owner `acme`. Needs a real org FK, per-org uniqueness, and a data
  migration off the URL hack.
- **`operations` has no `organization_id`** (`schema-platform.ts:37`), so the operation log is
  unfilterable by tenant and lookups have no tenant predicate.
- **Installation-scoped audit is dead code.** The schema supports
  `scope_type='installation'`, but `audit-events.service.ts` hardcodes `'organization'` — org
  creation and other cross-org actions leave no trail. Cloud staff actions must land here.
- **Single global product-log budget**: one `'global'` row caps log storage for the whole
  installation at 1 GiB (`packages/api/src/queries/product-log-storage-policy.ts`). When the
  budget is full, ingest silently **drops new log lines from every org**
  (`takeEventsWithinQuota`, `deployment-product-logs.query.ts:84`) until age-based retention
  frees space — old logs are not rotated out to make room. Owner call: replace the byte-quota
  model with a per-app ring buffer — keep the last 1000 lines per app, trim on ingest, remove
  the global quota accounting.
- **API scoping stays header-based** (`x-compartment-organization`, flat `/v1/*` paths —
  decision D2). The enforcement chain is correct and tested; keeping the header makes three
  disciplines mandatory instead of structural, and they become tracked work: org-keyed
  post-auth rate-limit buckets (today IP-only, `packages/api/src/http/rate-limit.ts`),
  resolved-org slugs in access logs (per-tenant incident debugging), and a `Vary`/no-cache
  guard on org-scoped responses so no future caching layer can leak across tenants. The
  ambient-context hazard (stale client org retargeting a request) is mitigated at the client
  edges: per-repo org binding in the CLI (see below) and org-pinned request context in the
  console.
- **CLI org context is per-remote, not per-repo** (`CliRemoteConfig.currentOrganization`). Two
  repos in different orgs against one cloud endpoint fight over `org use`. Add an
  `organization` key to `compartment.yml` or `.compartment/state.json` and prefer it.

### G3. Hostile-tenant isolation

Ordered by severity.

1. **Installation-wide `runtimeControlToken` inside tenant build pods.** The build Job runner
   receives it as `COMPARTMENT_BUILD_JOB_INTERNAL_TOKEN`
   (`packages/worker/src/services/worker-build.service.ts:77` →
   `worker-build-job.service.ts`), and that bearer authenticates _every_ internal API route —
   including any tenant's source archive. Today gVisor + the BuildKit container boundary are all
   that separate tenant build code from an omnipotent credential. Replace with per-build,
   artifact-scoped, short-TTL credentials (the registry credential HMAC scheme in
   `packages/worker/src/registry-credentials.ts` is the in-repo template).
2. **Tenant ingress isolation did not exist. (RESOLVED — mechanism found, fix in flight.)**
   Established on a live managed-VM install, not inferred. Every tenant ingress policy shipped
   **without its `from` peer list**: the Kubernetes JS client generates
   `V1NetworkPolicyIngressRule` with the model property `_from` mapped to the wire field `from`,
   and `ObjectSerializer` reads manifests by model property name — so a manifest written with
   `from` serialized to nothing while `ports` survived. An ingress rule with ports and no `from`
   allows that port from **every** source in the cluster. `V1NetworkPolicyEgressRule.to` has no
   such rename, which is why egress rules always worked and hid the asymmetry.

   Proven exploitable: a plain Pod in an unrelated namespace fetched a tenant app by Pod IP
   (`hello from app-b`) and found the tenant's PostgreSQL open (`10.42.0.49:5432 open`). What
   actually separated tenants was only the **source-side** egress rule blocking the pod CIDR —
   one layer where two were designed, and nothing at all against any workload with unrestricted
   egress. The gVisor hypothesis is dead: tenant Pods do run under `runsc`, but the runtime was
   irrelevant.

   Consequences worth carrying: PR #312 corrected a peer value in a block that never reached the
   API server, and PR #321's gate applies manifests via `kubectl` (which decodes wire names)
   while production goes through the client library — so both were effective in tests only.
   Fixes: PR #322 (transport contract, named types so wire names are a compile error), plus
   PR #324 (resource port aggregate) and PR #334 (see below). Still open: enforcement is never
   verified at install time (`docs/specs/existing-kubernetes-install.md:40`).

   **Turning enforcement on exposed a second, older defect — budget for this.** Once the peer
   list actually reached the cluster, `compartment deploy` failed for every project with a
   resource. The cause was not the policy: on k3s, kube-router terminates each per-Pod chain
   with `REJECT --reject-with icmp-port-unreachable`, so **a NetworkPolicy denial surfaces as
   `Connection refused`**, indistinguishable from "nothing is listening" — which is why six CI
   rounds hunting for a timeout found nothing. kube-router expands every peer into a
   `KUBE-SRC-*` ipset, and a Pod dialling within ~1–2s of its own creation is not yet in that
   set. Measured live: 12 fresh Pods needed 1–7 attempts each; a clean A/B against a
   definitely-listening target gave 5/5 refused with peers and 5/5 succeeded without. No peer
   shape avoids it, and Job-level retry cannot help because each retry is a new Pod with a new
   IP. The platform gave a Job exactly one chance to connect, and that chance was its Pod's
   first packet. Fixed in PR #334 by an init container that waits until each declared resource
   endpoint accepts a connection, for application Pods and Job Pods alike, bounded by the
   resource's declared `readiness.timeoutMs`. The fact is now recorded in
   `docs/specs/k8s-runtime.md`. Note the shape of this: enforcement did not _create_ a defect,
   it made a latent one reachable — expect more of that as the remaining isolation gaps close.

   **Method lesson for the cloud program.** Four separate defects this session shared one
   shape: CI validated a configuration that production does not use. The enforcement gate
   rendered its own literal instead of the production projection; the k3d containerd fixture
   omitted the gVisor mount-annotation allow-list, so CI ran gVisor with gofer-backed volumes
   and never charged tmpfs to Pod memory; the gate applied manifests through `kubectl` while
   production uses the client serializer; and the same gate's fixtures used labels production
   never emits. None was findable from a green test suite. A fifth was nearly added by hand —
   a proposed image-pull credential for tenant ServiceAccounts would have been dead weight,
   since platform images are pulled with node-level credentials and no chart secret exists.
   Treat a recurring acceptance run on a real installation as a required gate before the cloud
   launch, not as optional diligence — and prefer reproducing a failure where you can attach a
   debugger over instrumenting one you can only watch: six CI post-mortems at 45 minutes each
   failed where one live run on a VM succeeded in an hour.

3. **No per-org capacity limits.** ResourceQuota is a hardcoded constant per project (50 pods /
   20 CPU / 20Gi / 100Gi) and nothing caps projects per org — unbounded namespaces × quota.
   Builds: global `maximumConcurrentBuilds: 2` with per-project fairness only
   (`packages/api/src/queries/deployment-claim.query.ts`) — one org starves the queue. Edge
   rate limits are installation-wide Caddy constants, not per-tenant. All three need an org
   dimension, fed by plan entitlements (G4).
4. **One KEK for all tenant secrets** (`COMPARTMENT_TENANT_SECRETS_KEK`,
   `packages/worker/src/tenant-secret-environment.ts`). Move to per-org derived keys (HKDF from
   the KEK is a cheap first step; KMS envelope later). Same review for the session-token hash
   secret and the single wildcard TLS key.
5. **Unlimited egress ports for tenant apps** (`internetEgressRule` sets no ports; builds are
   already 80/443-restricted). SMTP/scanning/exfil surface — restrict by default, make
   exceptions a plan feature. Also harden the egress `except` list beyond RFC1918 (a cluster on
   `100.64.0.0/10` leaves pod-to-pod IP egress open) and the DNS-wide enumeration allowance.
6. **Edge blast radius.** Every edge replica pulls the _entire_ installation's routes + all
   principals' grants every 5 s (`packages/api/src/services/app-access-state.service.ts`,
   `packages/edge/src/services/edge-bootstrap.service.ts:22`) and holds them in memory/disk,
   authenticated by one static internal token. O(all orgs × grants) per replica per 5 s; also a
   full resync on every invite. Needs incremental sync and/or org-sharded snapshots.
7. Smaller items: non-expiring registry pull credentials
   (`registry-credentials.ts:74`); app containers lack `readOnlyRootFilesystem`; shared tenant
   node pool with no per-org affinity tier; gVisor as the sole kernel boundary for
   root+SYS_ADMIN BuildKit (acceptable, but document the threat model; per-org node pools as a
   paid tier is the escape hatch).

### G4. Billing and plans

Nothing exists — no plans, entitlements, Stripe, or license surface (verified by sweep). But the
hard half is already shipped: org-keyed hourly usage for compute (`cpu_millicore_seconds`,
`memory_byte_seconds`), edge traffic (bytes/requests/4xx/5xx), and build/release job seconds,
deduplicated and retention-managed. **Nothing reads these tables.** Build order:

1. Plan/entitlement model (org → plan → limits: projects, concurrent builds, CPU/mem/storage
   ceilings, egress features, log budget, seats) — the enforcement points in G3.3 read this.
2. Usage read APIs + console usage page (first consumer of the ledger; also self-hosted value).
3. Payment integration (Stripe: customer per org, metered + seat items, webhooks → entitlement
   state machine: `trialing → active → past_due → suspended`).
4. Suspension semantics: what stops when an org doesn't pay (deploys blocked first, then scale
   to zero, then retention deletion) — reuse the existing archived/retention machinery.

### G5. Platform-operator plane

- **No role above org admin exists**, and org admins can create unlimited orgs. Introduce
  platform-staff principals (separate from tenant RBAC), an operator API/console: org list,
  plan overrides, suspend/restore, delete with export, support impersonation (time-boxed,
  audited into the installation scope from G2), abuse queue.
- **Installation identity**: "installed" is literally `count(organizations) > 0`
  (`packages/api/src/queries/install.query.ts:75`). The cloud needs an explicit installation
  identity and a tenant-provisioning API distinct from `/v1/install`.
- **Org lifecycle**: FK cascades exist, but offboarding needs product semantics — export,
  grace period, custom-domain release, subdomain reuse policy, backup restore per org.
- **Abuse controls**: per-tenant API rate limits (today IP-keyed only,
  `packages/api/src/http/rate-limit.ts`), signup throttling, email verification, payment-method
  gating for compute, egress/SMTP defaults from G3.5.

### G6. Scale-out of single-instance assumptions

- **Postgres is also the blob store**: full product log lines and base64 source archives (up to
  100 MiB each, `schema-source-uploads.ts`) live in the one `Recreate` Postgres. Cloud: managed
  PG (`postgres.external.enabled` exists), archives → object storage, logs → a log store with
  per-org budgets.
- **Registry**: single replica + RWO PVC today; cloud profile enables the existing
  `registry.storage.backend: s3` and makes replicas configurable (hardcoded to 1 in the chart) —
  see D5 (resolved).
- **Build capacity**: global cap of 2 → autoscaled build pool with per-org fairness and
  plan-based concurrency.
- **API multi-replica**: the >1-replica path silently swaps the archive PVC for `emptyDir`
  (`deploy/chart/compartment/templates/api.yaml:122`) — fine once archives move to object
  storage, but must become the tested path.
- **Cell architecture (later)**: the broker already allocates per-org zones, so org → cell
  placement is compatible with the domain scheme from day one. Start single-cell/single-region;
  keep org-id on every table (already true) so cell extraction stays a data-move, not a schema
  change.

### G7. Product surfaces

- **Console has zero settings pages** — org settings, domains, git sources, SSO, variables at
  org level are CLI-only; there is no create-organization UI and no billing UI. The cloud
  funnel (signup → create org → first deploy) is web-first, so this IA gap is launch-blocking.
  The existing per-org first-deploy onboarding (`onboarding_first_deploy_sessions`) is the right
  foundation.
- **Bare console paths** (`/users`, `/audit`, …) are not server-registered (only
  `/projects/create` is) — audit the client-fallback asymmetry while touching routing.
- **The app-sharing line** (guest access to hosted apps, in-flight branches) intersects the
  cloud trust model — guests are the first "stranger" principals; align its principal model
  with signup identities rather than inventing a second external-identity path.

## Decisions required (owner)

- **D1 — Product shape: DECIDED — Shape A (shared multi-tenant)** is the cloud; Shape B
  (dedicated installs) remains a possible later premium tier. Everything below assumes A.
- **D2 — API org scoping: DECIDED — keep the `x-compartment-organization` header.** Owner
  call: the path migration (`/v1/orgs/:slug/...`) is churn across every route and ~45 SDK
  services for no functional gain on a stack we fully control. The risks path scoping would
  have eliminated structurally are instead covered by three mandatory follow-ups (tracked as
  T2.4): org-keyed post-auth rate-limit buckets, resolved-org slugs in access logs, and a
  `Vary`/no-cache guard on org-scoped responses if any response caching ever appears.
- **D3 — Host scheme: DECIDED — deferred past V1** (beta keeps the current org-less flat
  labels; revisit before GA). Original analysis kept for the revisit:
  `<app-label>.<org>.<zone>` vs an org segment inside the label on one shared zone. Verified status quo: `buildCanonicalAppLabel` uses only
  `[serviceName?, projectName, environmentSegment]` (`public-hosts.service.ts:90`);
  `organizationId` appears solely as the collision-suffix hash seed. (On managed installs the
  _zone itself_ is derived from the first org's slug at install time —
  `managed-domain-label.service.ts` — but that is one zone per installation; later orgs share
  it.) Trade-off to weigh: per-org zones give clean per-org namespaces but need per-org
  wildcard certs — a `*.zone` wildcard covers one label level only, and Let's Encrypt's
  ~50 certs/week/apex cap would gate org onboarding without a rate-limit exemption or another
  CA; org-in-label lives under the single existing wildcard with zero new cert operations.
  Existing self-hosted installs keep today's scheme either way; the org segment activates only
  for multi-org installations.
- **D4 — Identity model: DECIDED — keep the global "one account, many orgs" model** (global
  email uniqueness, one credential set per principal, org membership on top). Follow-ups stay
  in scope: explicit invite acceptance instead of silent cross-org account linking, and
  enumeration-safe signup/reset responses.
- **D5 — Cloud registry: RESOLVED — the bundled registry stays.** This was never a
  product choice, only a scaling one: the cloud profile flips the already-shipped
  `registry.storage.backend: s3` (`deploy/chart/compartment/values.yaml:205`) and makes
  registry replicas configurable (currently hardcoded to 1 in
  `deploy/chart/compartment/templates/registry.yaml:23`). With state in S3 the registry scales
  horizontally and the RWO-PVC single point of failure disappears; the path-scoped HMAC
  credential scheme already handles multi-tenancy.

## Phased plan

Phases are dependency-ordered; each track is sized to a Codex track (roughly a PR-series each).
Estimates are engineering effort at the current track cadence, not calendar promises.

**Phase 0 — Seam fixes that are correct regardless of the cloud (1–2 weeks).**
T0.1 NetworkPolicy peer label fix + live enforcement check on k3d/k3s (G3.2).
T0.2 `git_provider_registrations.organization_id` + per-org uniqueness + migration off the
URL substring hack (G2).
T0.3 `operations.organization_id`; wire installation-scope audit writer (G2).
T0.4 Product-log store rework: keep only the last 1000 lines per app (per environment
service / resource container), trimming on ingest; delete the global 1 GiB byte quota and
its `product_log_store_quota` accounting entirely (G2).
T0.5 Drop the platform PriorityClass from build Jobs: `worker-build-job.service.ts:89` pins
`compartment-platform` (value 1000000, `PreemptLowerPriority`), so tenant build pods schedule
as control-plane peers and can preempt tenant apps; move builds to the tenant class or a
dedicated lower class.

**Phase 1 — Hostile-tenant hardening (3–5 weeks).**
T1.1 Scoped per-build credentials replacing `runtimeControlToken` in build pods (G3.1).
T1.2 Fail-closed NetworkPolicy enforcement probe at install/startup (G3.2).
T1.3 Org-dimension limits: projects-per-org, org build concurrency + fair claim, per-org edge
rate limits (G3.3) — mechanism now, plan wiring in Phase 3.
T1.4 Per-org secret key derivation (G3.4).
T1.5 Egress default tightening + CIDR robustness (G3.5).
T1.6 Edge incremental/org-sharded state sync (G3.6) — the one architecturally heavy track.

**Phase 2 — Self-serve identity (2–3 weeks).**
T2.1 Mail subsystem (provider abstraction, templates, audit) — **deferred past V1**; V1 signup
needs no transport, and the surfaces that do need one (invitations at scale, billing notices)
are themselves past V1.
T2.2 CLI signup: unauthenticated account+org+session mint behind an off-by-default env flag,
separate authenticated set-password command, per-IP throttle. Org-creation quotas and reserved
slugs stay in scope; retire single-org login fast paths (G1). No verification, no console page.
T2.3 Email invitations + accept-invite landing; explicit account-linking on cross-org invite.
T2.4 D2 header disciplines: org-keyed rate-limit buckets, org-tagged access logs,
cache-`Vary`/no-cache guard on org-scoped responses.
T2.5 Console settings IA: org settings, members, domains, git sources, SSO pages (G7).

**Phase 3 — Billing (3–4 weeks).**
T3.1 Plan/entitlement model + enforcement wiring into Phase 1 limit points.
T3.2 Usage read APIs + console usage page.
T3.3 Stripe integration + subscription state machine + suspension semantics.

**Phase 4 — Cloud operations (3–5 weeks, parallel to Phase 3 after Phase 1).**
T4.1 Per-org host scheme (D3) end-to-end: allocation, edge routing, certs via broker.
T4.2 Platform-operator plane: staff roles, operator surface, impersonation with
installation-scoped audit, abuse queue (G5).
T4.3 Storage offload: external PG, archives to object storage, registry S3 + multi-replica,
tested multi-replica API (G6).
T4.4 Org lifecycle: suspend/export/delete/domain-release (G5).

**Phase 5 — Launch hardening (2–3 weeks).**
Load tests at O(1000 orgs) fixtures (edge sync, claim query, login discovery), pen-test pass on
the G3 items, dogfood migration, docs/pricing/status page.

Total: roughly 15–23 engineering weeks across the tracks before a gated beta, with Phase 0+1
alone yielding a defensible "multiple trusted-ish orgs on one install" story and Phases 2–4
delivering the actual public cloud.

## V1 scope — free gated beta

Owner cut: the first cloud version is free and **open to self-registration** — deliberately.
The product is disposable hosting whose intended user is an agent, so an account must be
obtainable unattended, from the CLI, with no human in the loop. The env flag below gates
self-hosted installations, not cloud users: on the cloud it is on and anyone may register.

That reverses the earlier abuse posture, so state the residual honestly. Free + open signup +
no billing is a miner magnet, and the invite gate that was supposed to answer it is gone, as
is email verification. What remains is fixed per-org caps, per-IP signup throttling, and
manual suspend — thinner than the original plan assumed, and the reason caps and the build
namespace backstop (items 2 and 3) stop being merely prudent and become load-bearing.

Roughly 5–7 engineering weeks.

**Status as of 2026-08-10.** Items 1, 4 and 5 have shipped; 2 is in review; 3 is half done.
What remains is items 6 and 7 plus the two open pieces called out below — roughly 2–3 weeks,
and none of it is identity work any more.

| #   | Item                        | State                                                                       |
| --- | --------------------------- | --------------------------------------------------------------------------- |
| 1   | Phase 0 fixes               | shipped                                                                     |
| 2   | Fixed max resources per org | in review (#318)                                                            |
| 3   | Builds parallel but bounded | build limits raised; **ResourceQuota on the build namespace still missing** |
| 4   | Scoped build credentials    | shipped (#329)                                                              |
| 5   | Signup                      | shipped (#337)                                                              |
| 6   | Deploy the cloud somewhere  | not started                                                                 |
| 7   | Load test ~100 orgs         | not started                                                                 |

**Ships in V1 (owner's list, priority order):**

1. **Fixes** — all of Phase 0 (T0.1–T0.5): netpol peer-label fix, git-provider org FK,
   `operations.organization_id` + installation-scope audit writer, the product-log rework
   (last 1000 lines per app, global byte quota removed), and the build-Job PriorityClass fix
   (builds currently run at platform priority 1000000 next to api/edge/postgres). (1–2 wk)
2. **Fixed max resources per org** — a direct per-org compute/storage ceiling (constants, no
   plan model, not a project-count proxy). Kubernetes has no cross-namespace quota, so the
   control plane enforces an org ledger: the sum of the org's namespace quotas/usage is
   checked against the ceiling at project creation and deploy admission; per-project
   ResourceQuota stays as the namespace-level sub-limit. (~1 wk)
3. **Builds: many in parallel, bounded** — raise the global build pool beyond the current
   `maximumConcurrentBuilds: 2`; add a per-org concurrency cap and org-fair ordering to the
   claim query (today fairness is per-project only). Per-build pod resource limits already
   exist (`runnerResources`/`buildKitResources`); add a ResourceQuota on the
   `compartment-build` namespace as the hard backstop so the build fleet cannot sink tenant
   or platform nodes. (~1 wk)
4. **Scoped build credentials** — replace the installation-wide `runtimeControlToken` in
   build pods with per-build, artifact-scoped, short-TTL credentials (the HMAC scheme in
   `registry-credentials.ts` is the template). (1–2 wk)
5. **Signup — CLI only.** `POST /auth/signup` creates the principal, its first organization,
   and a session in one unauthenticated call; `compartment signup` persists that session
   through the existing CLI store, so an agent registers and deploys without a browser. A
   password is set afterwards by a separate authenticated command, which is what later grants
   console access — today no "set my own password" path exists at all, only the activation-
   and reset-token flows. Behind a system env flag, **off by default**, on for the cloud.
   Per-IP throttling on the route reuses the existing auth throttle buckets.

   No mail, no verification, no web signup page, no invite codes — all struck deliberately;
   an agent cannot read an inbox. Email stays a bare identifier and is generated when the
   caller omits it, so unattended registration never collides. Additional organizations keep
   using the existing authenticated route and `compartment org create`, unchanged. (~0.5 wk)

6. **Deploy the cloud somewhere** — one cluster, the existing chart's cloud profile: external
   Postgres, registry with S3 storage backend + >1 replicas, cloud zone + wildcard cert,
   backups, and a one-time NetworkPolicy-enforcement verification on the chosen CNI (replaces
   the general fail-closed probe for V1, since we control this cluster). (~1 wk + provider
   decisions)
7. **Load test** — ~100-org fixtures over the hot paths: edge snapshot sync, build claim
   fairness, signup, deploy. (~1 wk)

**Deferred past V1** (returns with GA/paid tiers):

- **D3 org-in-label hosts — owner call: not in V1.** Beta keeps today's scheme (first-come
  labels + hash suffix across orgs, shared zone). Accepted consequence: enabling an org
  segment later renames existing users' canonical app URLs.
- Per-org edge rate limits and the SMTP-class egress block (owner cut).
- CLI per-repo org binding (owner cut — multi-org CLI users switch with `org use`).
- All of Phase 3 (plans/entitlements, Stripe, usage read APIs and console usage page — the
  metering ledger keeps writing meanwhile).
- T1.6 edge incremental sync — the 5 s full snapshot survives beta scale; add a size metric
  and a hard review gate (e.g. snapshot > 5 MB or > 500 orgs) before opening signups wider.
- T1.4 per-org KEK derivation; full egress port policy beyond the SMTP-class blocks.
- T1.2 general fail-closed netpol probe as a product feature (V1 verifies the one cloud
  cluster during deployment instead).
- Email delivery for org invitations; console settings IA (org settings/domains/SSO/git
  pages — CLI covers it; the beta audience is CLI-first).
- Operator console and abuse tooling (V1 staff ops run through the system API/CLI/DB
  runbooks), support impersonation.
- Archive offload to object storage (retention only in V1), log-store re-architecture.
- O(1000) load certification, cell architecture, dedicated tier (Shape B).

## Non-goals (this iteration)

- Multi-region/cell placement (design-compatible via D3, not built).
- Shape B dedicated tier automation.
- Per-org node pools (premium isolation tier — later, the scheduling hooks already exist).
- Replacing gVisor or adding VM-level sandboxing.

## Primary evidence index

Tenancy enforcement: `packages/api/src/routes/protected/{current-organization-route,authorize-request}.ts` ·
schema: `packages/api/src/db/schema-{core,access,platform,deploy,kube-runtime}.ts` ·
org services: `packages/api/src/services/{organizations,create-organization,organization-auth-settings}.service.ts` ·
hosts: `packages/api/src/services/{public-hosts,deployment-route}.service.ts` ·
edge state: `packages/api/src/services/app-access-state.service.ts`, `packages/edge/src/services/edge-bootstrap.service.ts` ·
isolation: `packages/kube-runtime/src/kube-{provisioning,network-policy-projection,resource-quota-projection,security-context}.ts`, `packages/worker/src/project-network-policy.ts` ·
builds: `packages/worker/src/services/worker-build{,-job}.service.ts`, `deploy/chart/compartment/templates/buildkit.yaml` ·
secrets: `packages/worker/src/tenant-secret-environment.ts` ·
metering: `packages/api/src/{db/schema-kube-runtime.ts,services/usage-metering.service.ts}` ·
broker: `packages/contracts/src/contracts/managed-domain.contract.ts`, `packages/cli/src/services/managed-domain-label.service.ts` ·
CLI context: `packages/cli/src/store/config.types.ts`, `packages/cli/src/services/context.service.ts`.
