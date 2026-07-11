# Kubernetes Runtime Coordination Inventory

## Purpose

This inventory is the G1 baseline for reducing runtime coordination in the API
and worker by at least 60%. It records production files that directly own
runtime orchestration or persisted runtime state before the Kubernetes cutover.

The baseline is 23 files and 2,029 physical lines. Tests and harness code are
excluded. Counts use `wc -l` and include blank lines and comments.

## API: 1,365 lines

| Lines | File                                                                      |
| ----: | ------------------------------------------------------------------------- |
|    86 | `packages/api/src/services/deployment-runtime-plan.service.ts`            |
|   103 | `packages/api/src/services/deployment-runtime-state.service.ts`           |
|    12 | `packages/api/src/services/deployment-upstream.service.ts`                |
|   125 | `packages/api/src/services/deployment-completion.service.ts`              |
|   139 | `packages/api/src/services/deployment-worker-finalization.service.ts`     |
|   150 | `packages/api/src/services/deployment-worker-state.service.ts`            |
|    10 | `packages/api/src/services/node-runtime-requester.ts`                     |
|    95 | `packages/api/src/queries/deployment-completion.query.ts`                 |
|    25 | `packages/api/src/queries/deployment-completion.query.types.ts`           |
|    37 | `packages/api/src/queries/deployment-lifecycle.query.ts`                  |
|   213 | `packages/api/src/queries/deployments.query.ts`                           |
|   188 | `packages/api/src/queries/deployments.query.types.ts`                     |
|   114 | `packages/api/src/queries/deployments.query.write.types.ts`               |
|    34 | `packages/api/src/routes/internal/post-deployment-runtime-event.route.ts` |
|    34 | `packages/api/src/routes/internal/post-deployment-runtime-state.route.ts` |

## Worker: 664 lines

| Lines | File                                                                         |
| ----: | ---------------------------------------------------------------------------- |
|   143 | `packages/worker/src/services/worker-deployment-tracking.service.ts`         |
|    28 | `packages/worker/src/services/worker-deployment-tracking.types.ts`           |
|    78 | `packages/worker/src/services/worker-runtime-deploy.helpers.ts`              |
|    45 | `packages/worker/src/services/worker-runtime-deploy.service.helpers.ts`      |
|   241 | `packages/worker/src/services/worker-runtime-deploy.service.ts`              |
|    27 | `packages/worker/src/services/worker-runtime-deploy.types.ts`                |
|    57 | `packages/worker/src/services/worker-runtime-network-reservation.service.ts` |
|    45 | `packages/worker/src/services/worker-runtime-release.service.ts`             |

## Reproduce

```sh
wc -l \
  packages/api/src/services/deployment-runtime-plan.service.ts \
  packages/api/src/services/deployment-runtime-state.service.ts \
  packages/api/src/services/deployment-upstream.service.ts \
  packages/api/src/services/deployment-completion.service.ts \
  packages/api/src/services/deployment-worker-finalization.service.ts \
  packages/api/src/services/deployment-worker-state.service.ts \
  packages/api/src/services/node-runtime-requester.ts \
  packages/api/src/queries/deployment-completion.query.ts \
  packages/api/src/queries/deployment-completion.query.types.ts \
  packages/api/src/queries/deployment-lifecycle.query.ts \
  packages/api/src/queries/deployments.query.ts \
  packages/api/src/queries/deployments.query.types.ts \
  packages/api/src/queries/deployments.query.write.types.ts \
  packages/api/src/routes/internal/post-deployment-runtime-event.route.ts \
  packages/api/src/routes/internal/post-deployment-runtime-state.route.ts \
  packages/worker/src/services/worker-deployment-tracking.service.ts \
  packages/worker/src/services/worker-deployment-tracking.types.ts \
  packages/worker/src/services/worker-runtime-deploy.helpers.ts \
  packages/worker/src/services/worker-runtime-deploy.service.helpers.ts \
  packages/worker/src/services/worker-runtime-deploy.service.ts \
  packages/worker/src/services/worker-runtime-deploy.types.ts \
  packages/worker/src/services/worker-runtime-network-reservation.service.ts \
  packages/worker/src/services/worker-runtime-release.service.ts
```

## G1 comparison rule

The final P1 report must compare this same named surface against the retained
coordination after the change. New `kube-runtime` runtime lines are reported
separately from test and scenario harness lines. Files are not removed from the
denominator merely because ownership or names change.
