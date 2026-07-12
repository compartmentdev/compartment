# P4 Product Job Report

## Result

P4 adds the minimal live worker Kubernetes controller host that was absent from
P1. The worker loads in-cluster kubeconfig with `KUBECONFIG` file fallback,
instantiates `KubeRuntime`, and reconciles unfinished product Jobs. This host is
the foundation where P2 release and P3 resource-operation scopes register.
It does not reconcile deployment or resource projections.

Product Jobs use the durable sequence `intent -> create/join -> terminal
capture -> database persistence -> TTL finalization`. A restarted worker joins
the deterministic Job name, including when Kubernetes already observed its
terminal state. Timeout deletes the Job after capturing available logs.

## LOC and D33

| Surface                     | Baseline | P4 delta | Total |
| --------------------------- | -------: | -------: | ----: |
| `packages/kube-runtime/src` |    1,114 |     +190 | 1,304 |
| `packages/worker/src`       |    3,686 |     +178 | 3,864 |

The Kubernetes runtime remains 1,696 lines below the D33 limit of 3,000.
Worker LOC is reported separately and is not charged to D33.

Reproduce:

```sh
find packages/kube-runtime/src -name '*.ts' -type f -print0 | xargs -0 wc -l
find packages/worker/src -name '*.ts' -type f -print0 | xargs -0 wc -l
```

## Coordination made unnecessary

Consumers do not implement their own Kubernetes status polling and do not
restart release commands during recovery. Deterministic naming plus junction
recovery converges on the existing Job, while the database acknowledgement
gates TTL cleanup.

## Delete list

P4 is additive. P2 deletes the legacy release path after cutover:

- `packages/worker/src/services/worker-runtime-release.service.ts` — deleted by P2;
- `packages/node/src/routes/internal/post-runtime-release.route.ts` — deleted by P2.

P3 owns deletion of the legacy resource-operation execution path.
