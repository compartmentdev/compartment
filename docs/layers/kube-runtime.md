# Kubernetes Runtime Layer

Owns:

- the nine Kubernetes transport primitives: `apply`, `mergePatchExisting`, `observe`, `read`, `delete`,
  `observePodMetrics`, `logs`, `runJob`, and namespaced Lease leader election; only `apply`, `mergePatchExisting`,
  `delete`, `runJob`, and leader election write Kubernetes state;
- server-side apply through `@kubernetes/client-node` with field manager `compartment`;
- label-scoped informer caches and their reconnect, relist, health, and observed-at lifecycle;
- deterministic immutable-ID naming and pure database-row-to-manifest projections;
- pure rollout status and readiness classification from Kubernetes observations.

May depend on:

- `@kubernetes/client-node` as the only Kubernetes transport client.

Must not:

- depend on API, worker, CLI, HTTP, or database implementation types;
- persist state or audit events;
- own deployment workflow orchestration;
- expose raw client-node clients, raw watches, client-side diffing, or `KubeXxxService` wrappers;
- accept mutable names as canonical selectors or identifiers;
- add runtime primitives beyond the nine documented operations without updating this boundary and its tests.

Change checklist:

- keep manifests and public inputs explicitly typed;
- keep projections pure and names derived only from immutable IDs;
- preserve one lifecycle wrapper per informer and one restart timer per wrapper;
- protect rollout convergence, informer disconnect, and projection YAML with permanent tests;
- report production runtime LOC separately from tests and harness code.
