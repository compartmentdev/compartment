# P7 Product Logs and Pod Metrics

## Result

P7 adds durable Kubernetes application-log capture before Pod deletion. A Vector DaemonSet reads `/var/log/pods`, keeps checkpoints and a bounded disk buffer on the node, and sends bounded JSON batches to the API-owned PostgreSQL store. The store deduplicates on Pod UID, container/restart identity, and source byte offset.

`compartment logs` reads the product store for Kubernetes deployments. `--follow` polls for newly stored lines and is a convenience path, not storage. The legacy node runtime path remains additive until P10.

The worker reads metrics-server through the existing Kubernetes `observe` primitive and publishes an ephemeral snapshot to the API. `compartment status` and deployment details show raw CPU millicores and RAM bytes per Pod. Missing and older-than-30-second snapshots are explicit. This is operational raw material, not monitoring (D21).

## Bounds and retention

- source line: 4 KiB;
- HTTP batch: 200 events and 768 KiB;
- node-local disk buffer: 256 MiB with backpressure;
- product-store logical quota: 1 GiB, serialized at ingest and released by retention/cascade deletion;
- retry backoff capped at 30 seconds with effectively unbounded attempts, request timeout: 10 seconds, concurrency: 2;
- product query tail: 500 lines;
- retention: the existing instance retention window, deleted with the existing bounded batch and max-batch controls;
- SLO: 12,000 lines/s, below T6's measured safe point of 16,072 lines/s.

Vector internal buffer, drop, health, and hostPath filesystem free/used metrics are exported on port `9598`. The DaemonSet requests 320 MiB and limits 384 MiB ephemeral storage in addition to the explicit Vector disk-buffer bound.

## Loss guarantees

The durable path keeps the T6 node-local checkpoint model. Reopen and retransmission are idempotent. The identity is Pod UID, container/restart, byte offset, and a SHA-256 fingerprint of Vector's persisted event read identity plus the complete raw CRI record. HTTP retries retain that identity, while a new file generation receives a new identity even if it reuses an offset and contains an identical CRI record. Orderly rollout and force deletion are expected to lose zero accepted lines before the documented 12k lines/s SLO. OOM-kill loss is bounded by Vector's 500 ms disk synchronization interval; retransmitted lines are deduplicated. A sink outage fills at most the configured disk buffer and then applies backpressure instead of growing node usage without limit. Retry attempts are explicitly non-expiring; the 30-second value only caps the delay between attempts. A full product-store quota returns a retryable response, so the same bounded node backpressure applies until retention frees capacity.

Permanent negative-first coverage includes a Docker-backed run of the production Vector configuration through the HTTP sink with an outage/drain, checkpoint reopen, rotation with reused offset/timestamp, and the declared 12k lines/s threshold. Database coverage adds malformed identity/offset rejection, bounded contract batches, retention deletion and quota release, a distinct-ID P2 old-Pod/new-Pod rollout read through the active workload, OOM restart/replay, product-store quota rejection, Kubernetes Pod/metrics matching, stale snapshot filtering, metrics publication isolation, and quantity parsing. T6 remains the live-cluster evidence for force deletion, OOM, and node-buffer saturation.

## Manifest and rollout

The static manifests are `packages/worker/manifests/product-log-agent.yaml` and `packages/worker/manifests/worker-observability-rbac.yaml`. The agent references a Secret containing the internal ingest URL and a scoped ingest token; no credential is committed. Standalone installs can derive the token as `base64url(HMAC-SHA256(runtime-control-token, "compartment-product-log-ingest-v1"))`. The Helm chart instead generates a dedicated stable ingest secret and projects only that scoped credential into the agent, so a compromised node reader cannot call worker mutation routes.

The worker observability manifest grants the `compartment/compartment-worker` service account cluster-scoped `get`/`list` for core Pods and `metrics.k8s.io` Pods. Workload mutation remains namespace-scoped through the existing RoleBindings.

The P10.1 Helm wiring runs the DaemonSet in a dedicated privileged observability namespace, keeps its node-local buffer bounded, and waits for it during the full-stage rollout.

## D33 and LOC

The D33 coordination-core definition is updated in `docs/specs/k8s-runtime.md`. The final counts are 1,124 core lines, 600 projection/provisioning lines, and 498 type lines. The new capture-side surfaces are 223 manifest lines, 103 worker metric lines, and 90 Kubernetes metric-adapter lines; they do not count against the 1,500-line coordination-core limit.

## P10 delete list

P7 is additive. P10 must delete the Docker log path:

- API node runtime-log resolution and its SDK call;
- `packages/node/src/services/runtime-logs.service.ts` and adjacent types;
- `packages/node/src/routes/internal/get-runtime-logs.route.ts`;
- `packages/sdk/src/services/node-runtime-logs.service.ts`;
- runtime-node log contracts and tests;
- deployment-log fallback through SDK to the node.
