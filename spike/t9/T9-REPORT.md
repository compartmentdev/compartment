# T9 report: SSA, informer cache, and crash recovery

## Verdict

`@kubernetes/client-node` 1.4.0 is suitable for P1 with a small, mandatory informer lifecycle wrapper. SSA works through `KubernetesObjectApi.patch` with `PatchStrategy.ServerSideApply`, `fieldManager=compartment-t9`, and `force=false`. Informer list/watch and its cache are usable, including resource-version continuity, but an informer does **not** restart itself after an ordinary transport error: `ListWatch.doneHandler` emits `error` and returns. P1 must restart the same informer from its error callback with bounded exponential backoff and jitter. No raw-watch fallback is justified by this spike.

The spike uses only client-node list/watch informers for observed state. Direct `kubectl get` calls exist only in the external scenario harness as an independent assertion.

## State protocol

Persist desired intent before any Kubernetes write. JSON row persistence uses write-to-temp plus atomic rename, and DB row writes are serialized because informer callbacks are concurrent. Audit events use append-only writes.

| Persisted state | Meaning                                            | Recovery rule                                                                                                           |
| --------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `desired`       | Intent is durable; apply may not have happened     | SSA the deterministic Deployment+Service, then persist `pending`                                                        |
| `pending`       | Apply was attempted; Ready is not yet observed     | Re-apply if the informer cache is missing/drifted; otherwise wait for informer events                                   |
| `active`        | The informer observed the desired generation Ready | On delete/drift/non-Ready, append audit, re-apply as needed, and persist `pending`; return to `active` only after Ready |

All resource names derive from the one row id. Labels `compartment.track=t9` and `compartment.id=<id>` are required for cache admission and every ownership assertion. Startup waits for all four informer initial list/watch connections before reconciling durable rows. Event handlers are level-triggered and repeatable; no callback is treated as a transaction boundary.

## Kill matrix

Executed on k3s v1.35.5 with four deterministic `SIGSTOP` handshakes followed by `SIGKILL`. Every restart ended at one Deployment, one Service, one DB row, and `active`.

| Kill point                            | Durable state at kill       | Result after restart                                              |
| ------------------------------------- | --------------------------- | ----------------------------------------------------------------- |
| after DB `desired`, before apply      | `desired`, no objects       | PASS: apply created one bundle                                    |
| after apply, before `pending`         | `desired`, bundle may exist | PASS: repeated SSA was idempotent                                 |
| after apply, before Ready observation | `pending`, bundle exists    | PASS: cache event completed `active`                              |
| during informer callback              | any prior durable state     | PASS: replay/relist converged without duplicate status or objects |

## Negative-first scenarios

- Field ownership: a merge edit of replicas/image/env was observed and desired fields were re-applied. A forced SSA takeover by manager `human` produced HTTP 409; the controller first appended a `conflict` drift event, then explicitly forced ownership of only its declared SSA fields and converged. Objects without both ownership labels were not admitted or changed.
- Manual delete: informer `delete` appended an audit event and the deterministic resource was restored with SSA.
- Job junction: the controller was killed after the deterministic Job existed but before completion. On restart it observed that Job and its Pod through informers, read `t9-job-result` through the `logs(ref)` primitive, persisted it, and the label assertion found exactly one Job.
- Concurrency fault found: simultaneous Deployment/Service/Job callbacks initially collided on the same JSON temporary path. Serializing store transactions fixed both the rename failure and the potential lost update. P1 must use one real DB transaction per state transition.

## Informer disconnect

The host-to-API connection was cut by stopping `k3d-cpt-t9-serverlb`. While disconnected, the Deployment was patched through the server container. client-node emitted `FetchError ECONNREFUSED` and did not restart natively. The one-second spike wrapper restarted each informer; after the load balancer returned, the cache converged to current state, recorded the ownership conflict, forced the controller-owned fields, and restored desired replicas. Thus reconnect works only with our lifecycle wrapper. Source inspection of client-node 1.4.0 `ListWatch.doneHandler` shows that HTTP 410 clears `resourceVersion` and triggers a relist; 410 itself was not induced experimentally.

Production requirements for the wrapper: one restart timer per informer, exponential backoff with jitter and cap, health/readiness from last successful `connect`, error metrics, clean-stop suppression of `AbortError`, and a full relist after 410. The spike uses a fixed one-second delay only to keep the experiment small.

## Scale

Fifty durable rows produced 50 uniquely labelled Deployment+Service bundles through SSA. The exact informer-cache IDs matched both DB IDs and the independent label-list IDs; all 50 rows reached `active`. The final full-suite reconcile took **13 seconds** on the local k3d environment.

## Environment and budget

- Node 24.14.0 (repo engine requests 24.15.0; `doctor.sh` accepts major 24)
- pnpm 10.6.3
- @kubernetes/client-node 1.4.0
- kubectl 1.36.2
- k3d 5.9.0 / k3s 1.35.5

Executable prototype and harness: **669 lines** (`src`, `test`, and `run.sh`; package/config/lock/report excluded), 69 lines above the D33 budget. The excess is the negative-first evidence itself: 166 lines of crash/disconnect/ownership/Job/scale harness, plus the informer restart and initial-list barriers that client-node does not provide. All runtime source is 473 lines. P1 should keep the lifecycle wrapper package-owned and move scenario orchestration to system-test support. The harness is intentionally external and may query Kubernetes to verify that the controller's informer-only view converged.

## Reproduce

```sh
spike/env/doctor.sh
spike/env/up.sh t9
cd spike/t9
pnpm install --ignore-workspace --frozen-lockfile
pnpm typecheck
pnpm test
test/scenarios.sh all
cd ../..
spike/env/down.sh t9
```
