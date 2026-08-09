# Live State Authority

Status: proposed
Updated: 2026-08-09

`docs/specs/k8s-runtime.md` already assigns ownership: the database owns desired state, configuration, versions,
history, and audit, and Kubernetes owns live state. D30 adds that live state is never mirrored into PostgreSQL, and
that a cached status with `observedAt` is diagnostic data, not authoritative state.

This document does not restate that split. It states the test that decides which side of it a fact falls on, names
the single shape a consumer may use to obtain live state, and fixes what the system promises between a check and
the action that check guards. It was written after three defects found in one live acceptance session on a managed
install: #324, #325, and a resource `running` status that persisted across Pod replacement.

Note on words: admission in this repo means Kubernetes admission control, both the `ValidatingAdmissionPolicy` in
`k8s-runtime.md` and the webhook proposed in #318. The platform-side decision governed here is called gating.

## Decision

Every fact the platform acts on has exactly one authority and exactly one site that computes it.

Both halves are load-bearing and the three defects split across them. #324 had the right authority and two
computation sites, so two formulas over the same rows fought over an atomic server-side-apply list and
`spec.ingress` oscillated. #325 and the resource-status defect had one computation site reading the wrong
authority. They are not the same bug; they are the two ways this one invariant fails.

## Three classes of fact

**Record.** What an operator asked for, what we told the cluster, what happened, and any pure function of those
rows: descriptor-derived resource fields, queue ownership and claims, leases, reconcile history, audit. The port
aggregate in `packages/api/src/queries/network-policy-ports.query.ts` is the settled example. After #324 it is
computed once and applied verbatim, and the worker's second formula is gone.

**Live.** Any claim about what is true in the cluster now: is this Deployment serving, is this claim bound with
this UID, is this Job terminal, is there capacity for another Pod. No SQL predicate may answer one of these.

**Accumulation.** Cluster-sourced values persisted because the cluster does not retain them: `workload_usage_hourly`,
`job_usage_hourly`, captured Job logs and exit codes. D30 permits these because they record the past and are never
read as a claim about the present.

The test, applicable to any predicate in a diff: **if the Pod were deleted and replaced one second ago, must this
expression change its answer?** If it must, no database column may serve it. If it must not, no Kubernetes read may
serve it.

## A column name is not an authority

A column whose name suggests liveness is still Record unless its writer proves otherwise. Three currently do not:

- `project_resources.status = 'running'` is written from `intent.replicas === 0 ? 'stopped' : 'running'` in
  `packages/api/src/queries/resource-reconcile-completion.query.ts:58`. It means the last acknowledged reconcile
  intended replicas, so it survives the Pod being killed and replaced. That is what #325 hit.
- `deployment_kube_references.state = 'active'` records an acknowledged observation and the row carries `observedAt`
  with no observed generation (`packages/api/src/db/schema-kube-runtime.ts:30-33`). `deployment_custom_domains`
  pairs `desired_generation` with `observed_generation` and fences on their equality
  (`packages/api/src/queries/custom-domain-reconcile.query.ts:42`, `:131-132`). Only the second states what it is a
  cache of. A cached status admitted under D30 must carry that bound.
- `resource_reconcile_runs.phase = 'succeeded'` means two different things. For a bootstrap run it means the claims
  exist: `executeBootstrap` acknowledges after claim creation and never observes a Deployment
  (`packages/worker/src/services/worker-resource-reconcile.service.ts:80-94`). For an update run it means the
  Deployment converged (`:226-240`). A reader of "latest phase succeeded" is reading two facts under one name.

## Obtaining live state

D30 means a consumer needing Live must read the cluster. The read itself is not what duplicates; the formula around
it is. The existing Job gate is the required shape, in four stages that stay separate:

1. **Targets and budgets** are Record and are resolved in the claim transaction by one query module, so a resource
   created, replaced, or reconfigured after enqueue is still covered
   (`packages/api/src/queries/product-job-resource-readiness.query.ts`).
2. **Transport** is a `kube-runtime` primitive. `k8s-runtime.md` already assigns `read` to ownership and freshness
   fences; a gate is the same kind of question and uses the same direct API-server request. Only a convergence wait
   may use `observe`, whose cache reports health from the last successful connection rather than from the caller's
   clock, so its staleness is not the caller's to bound.
3. **Classification** is one pure function per question, owned by `kube-runtime` (`docs/layers/kube-runtime.md`).
4. **The verdict** is worker-owned. `packages/api` declares no `kube-runtime` dependency and imports none, so the
   control plane cannot read Live at all. Every gate is a worker decision over Record the API resolved for it.

A consumer may add a call site. A consumer may not add a classifier. A new liveness question is a new pure function
in `kube-runtime`, reviewed against the existing ones.

The two Deployment classifiers are deliberately different and must not be merged. `kubeDeploymentAvailable` judges
the object as it stands and is what a gate needs. `readKubeRolloutObservation` returns nothing unless the observed
object matches the applied manifest's UID and generation, which is what a convergence wait needs
(`packages/kube-runtime/src/kube-rollout.ts`).

## The window between a check and the action it guards

The system promises that no Job is created while a resource it dials reads unavailable at the last read before
creation, and that a resource still unready past its declared budget durably fails the Job without creating it
(`k8s-runtime.md`, claim eligibility and the direct-read gate).

It does not promise the resource is still serving when the container runs. Between the last read and the container
opening a socket lie Kubernetes admission, scheduling, and image pull, and the resource can be replaced in that
window. No preflight read closes it, and adding a second read only moves it.

So a gate is a scheduling decision and a deadline enforcer, not mutual exclusion. Mutual exclusion comes from the
claim transaction, which takes the resource runtime claim locks before deciding
(`packages/api/src/queries/product-job-claim.query.ts`). What is left is the tenant command's own connect retry,
which is the position `docs/specs/compartment-yaml.md` already takes: readiness is an opt-in signal, not a
substitute for application correctness. Narrow this window with a lock or accept it, not with another read.

## Ceilings and concurrency

Neither planned V1 item needs a live read, so neither becomes another copy of the Job gate.

Build concurrency is shipped. The global cap and the per-organization cap are both SQL over `deployments` and
`projects` inside the claim transaction, ordered least-active-organization then FIFO
(`packages/api/src/queries/deployment-claim.query.ts`). This is correct as Record because the claim is by design the
single queue-ownership mechanism, and a claim orphaned by a lost worker is recovered by a time-based reaper in the
same module, not by asking the cluster what is running.

Per-organization resource ceilings, as proposed in #318, delegate the Live fact to the cluster: a quota pool
selected by the organization label, enforced fail-closed by admission, with API state tracking reconciliation
readiness and never usage. Delegation is the third correct answer alongside Record and a gate, and it is the right
one whenever the cluster can both own the fact and enforce it.

That leaves one honest seam. A Record gate can be overturned by a Live refusal the queue never sees: a claimed build
whose Pod is denied capacity still consumes its build timeout. The rule is to make the refusal observable as a
durable outcome, not to predict it. Predicting capacity is mirroring live state.

## Migration

No call site moves. That is the finding, and it is why this document proposes no new mechanism.

- Nothing from #324 becomes redundant. #324 is the Record half of the invariant already applied, and #325 built the
  required staged shape. This document records both as rules rather than as one-off solutions.
- `releaseResourceReadinessFence` and `resourceOperationReconcileFence` keep their real jobs, which are ordering and
  terminality, and lose the readiness claim in their names
  (`packages/api/src/queries/product-job-release-readiness.query.ts`,
  `packages/api/src/queries/product-job-claim.query.ts`).
- The three vocabulary defects above are the backlog: a `running` status that means not-stopped, a cached state with
  no generation to bound it, and one phase name covering two facts.

## Non-goals

- a live-state cache, a status mirror, or a capacity predictor in PostgreSQL;
- a generic readiness service, registry, or framework wrapping the `kube-runtime` primitives;
- closing the window between a gate and the action it guards.
