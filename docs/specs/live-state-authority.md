# Live State Authority

Status: proposed
Updated: 2026-08-09

`docs/specs/k8s-runtime.md` already splits ownership between the database and Kubernetes, and D30 already forbids
mirroring live state into PostgreSQL. This document adds the test that decides which side a given fact falls on, the
one shape a consumer may use to obtain live state, and what the system promises between a check and the action that
check guards.

Admission in this repo means Kubernetes admission control. The platform-side decision governed here is a gate.

## Decision

Every fact the platform acts on has exactly one authority and exactly one site that computes it.

The two merged fixes below land on opposite halves of that sentence. #324 had the right authority and two
computation sites: two formulas over the same rows fought over an atomic server-side-apply list and `spec.ingress`
oscillated. #325 had one site reading the wrong authority; its commit message states the diagnosis, that the gates
were durable database facts which survive the live Pod being killed and replaced.

## Classes of fact

- **Record.** What an operator asked for, what we told the cluster, what happened, and any pure function of those
  rows: descriptor-derived resource fields, queue ownership and claims, leases, reconcile history, audit. The port
  aggregate in `packages/api/src/queries/network-policy-ports.query.ts` is the settled example — after #324 it is
  computed once and applied verbatim.
- **Live.** Any claim about what is true in the cluster now: is this Deployment's current generation serving, is
  this claim bound under this UID, is there room for another Pod. No SQL predicate may answer one of these.
- **Accumulation.** Cluster-sourced values persisted because the cluster does not retain them: `workload_usage_hourly`,
  `job_usage_hourly`, and a Job's terminal status, exit code, and logs, captured before the object is collected.
  These record the past and are never read as a claim about the present, which is why D30 permits them.

The test, applicable to any predicate in a diff: **had the cluster changed under it one second ago — a Pod replaced,
a claim rebound, capacity consumed — must this expression change its answer?** If it must, no database column may
serve it. If it must not, no Kubernetes read may serve it.

## Column names

A column whose name suggests liveness is still Record unless its writer proves otherwise. Three currently do not:

- `project_resources.status = 'running'` is written from the reconciled replica intent in
  `packages/api/src/queries/resource-reconcile-completion.query.ts` (`persistReconcileCompletion`). It means the
  last acknowledged reconcile intended replicas, so it survives the Pod being killed and replaced.
- `deployment_kube_references.state = 'active'` records an acknowledged observation, and the row carries
  `observed_at` with no observed generation. `deployment_custom_domains` instead pairs `desired_generation` with
  `observed_generation` and fences on their equality
  (`packages/api/src/queries/custom-domain-reconcile.query.ts`). Only the second states what it is a cache of, and a
  cached status admitted under D30 must carry that bound.
- `resource_reconcile_runs.phase = 'succeeded'` covers two facts. For a bootstrap run it means the claims exist:
  `executeBootstrap` acknowledges after claim creation and never applies or observes a Deployment. For an update run
  it means the Deployment converged first (`executeManagedUpdate`, both in
  `packages/worker/src/services/worker-resource-reconcile.service.ts`). `releaseResourceReadinessFence` reads
  "latest phase succeeded" across both.

## Obtaining live state

D30 means a consumer needing Live must read the cluster. The read is not what duplicates; the formula around it is.
The gate #325 built is the required shape, in four stages that stay separate:

1. **Targets and budgets** are Record, resolved by one query module inside the claim transaction
   (`packages/api/src/queries/product-job-resource-readiness.query.ts`).
2. **Transport** is a `kube-runtime` primitive. `k8s-runtime.md` assigns `read` to ownership and freshness fences; a
   gate is the same kind of question and takes the same direct API-server request. A convergence wait may use
   `observe`, whose cache can sit behind the API server across a reconnect or relist.
3. **Classification** is one pure function per question, owned by `kube-runtime` (`docs/layers/kube-runtime.md`).
4. **The verdict** is worker-owned. `packages/api` declares no `kube-runtime` dependency and imports none, so the
   control plane cannot read Live at all.

A consumer may add a call site. A consumer may not add a classifier. A new liveness question is a new pure function
in `kube-runtime`, and the review it must pass is that no existing classifier already answers it.

The two Deployment classifiers in `packages/kube-runtime/src/kube-rollout.ts` differ by anchor, not by rigor, and
must not be merged. `kubeDeploymentAvailable` is self-anchored: it needs no applied manifest and asks whether the
object's own current generation is fully available, which is what a gate needs. `readKubeRolloutObservation` is
anchored to a manifest the caller applied and returns nothing unless UID and generation both match, which is what a
convergence wait needs.

## The check-to-action window

The system promises that a Job is not created while a resource it dials reads unavailable, and that a resource still
unready past its declared budget fails the Job durably without creating it. `k8s-runtime.md` states both.

It does not promise the resource is still serving when the container runs. Kubernetes admission, scheduling, and
image pull sit between the last read and the first socket, and the resource can be replaced inside that gap.

A gate is therefore a scheduling decision and a deadline enforcer, not mutual exclusion. Mutual exclusion comes from
the claim transaction, which takes the resource runtime claim locks before deciding
(`packages/api/src/queries/product-job-claim.query.ts` and its release sibling).

Beyond that the retry belongs to the Pod, not to the control plane and not to the tenant's command. A denial on the
supported CNI is a connection refusal indistinguishable from nothing listening, and a brand-new Pod can be refused
for a short interval after it reaches Running, so the only place that can tell a refused connection from an absent
service is the Pod's own network namespace. `k8s-runtime.md` assigns that to a reachability init container ahead of
the tenant's containers. It closes no window this document promises to leave open: the resource can still be
replaced while the command runs, and a command that must survive that still owns its own reconnect, which is the
position `docs/specs/compartment-yaml.md` takes on readiness.

## Ceilings and concurrency

Build concurrency is shipped and needs no live read. Both the global and the per-organization cap are SQL inside the
claim transaction, ordered least-active-organization then FIFO
(`packages/api/src/queries/deployment-claim.query.ts`). A build counts as active while its row says `running` and no
`deployment_kube_references` row exists yet, which is Record measured against Record. A claim orphaned by a lost
worker is recovered by a time-based reaper in the same module, not by asking the cluster what is running.

Per-organization resource ceilings, proposed in #318, delegate the Live fact instead: a quota pool selected by the
organization label, enforced fail-closed by cluster admission, with API state tracking reconciliation readiness and
never usage. Delegation is a third correct answer whenever the cluster can both own a fact and enforce it.

One seam stays open. A Record gate can be overturned by a Live refusal the queue never sees: a claimed build whose
Pod is denied capacity keeps consuming its build timeout, as the install guide already documents. Make the refusal
observable as a durable outcome rather than predicting it.

## Migration

No call site moves, and one clause changes meaning.

- Nothing from #324 or #325 becomes redundant. #324 is the Record half of the invariant already applied, and #325
  built the shape stage 1 through 4 describe.
- `resourceOperationReconcileFence` is pure ordering over `(createdAt, id)` and an in-flight phase, and its name
  should say so (`packages/api/src/queries/product-job-claim.query.ts`).
- `releaseResourceReadinessFence` keeps ordering and terminality, but it also still tests
  `project_resources.status <> 'running'` and "latest reconcile succeeded" — both flagged above — now that the gate
  owns liveness (`packages/api/src/queries/product-job-release-readiness.query.ts`). Restating that clause as what
  it actually decides, whether a stopped resource blocks a release or fails it, is the one behavior change this
  model implies.
- The three column names above are the rest of the backlog.

## Evidence

- [#324 persisted port aggregate](https://github.com/compartmentdev/compartment/pull/324)
- [#325 product Job resource gate](https://github.com/compartmentdev/compartment/pull/325)
- [#316 organization-fair parallel build queue](https://github.com/compartmentdev/compartment/pull/316)
- [#318 organization resource quotas](https://github.com/compartmentdev/compartment/pull/318)

## Non-goals

- any cached observation, status mirror, or capacity prediction in PostgreSQL used as an authority or a gating
  input; a diagnostic cache carrying the bound described above stays permitted under D30;
- a generic readiness service, registry, or framework wrapping the `kube-runtime` primitives;
- closing the window between a gate and the action it guards.
