# T3 stateful resource spike

## Decision

P3 must treat every stateful image change as a platform transaction:

1. stop the writer and database;
2. verify that every selected pod is absent;
3. verify the PVC exists and its UID matches platform state;
4. server-side apply with field manager `t3`;
5. start PostgreSQL, wait for readiness, then start the writer.

`ReadWriteOnce` is not fencing. On the single-node k3d stand, two pods mounted
and wrote the same RWO local-path volume concurrently. The stand does not
support `ReadWriteOncePod`: `local-path` uses `rancher.io/local-path`, no
`CSIDriver` exists, the RWOP claim stayed Pending, and both consumers reported
`PVC is not bound`. The managed stop/verify/start sequence is therefore the
only single-writer mechanism on this stand.

## Results

| Scenario | Observed result |
| --- | --- |
| RWO negative control | `rwo-a` and `rwo-b` Ready on `k3d-cpt-t3-server-0` with the same claim |
| Managed v1 → v2 | writer-first complete pod stop: 2,061 ms; stop → writer Ready: 12,071 ms; committed high-water 5,200 retained |
| Managed v2 → v1 | cycle: 7,761 ms; committed high-water 5,710 and PVC UID retained |
| Image rollback / A4 | 6,050 contiguous valid rows after rollback; image rollback did not and must not roll back the data format |
| Kill in-flight writer | committed high-water 6,060 retained; uncommitted sentinel absent; 6,220 contiguous valid rows |
| Backup / cluster delete / restore | 6,220 rows restored from a local `pg_dump` artifact; checksum failures 0, gaps 0 |
| Missing-PVC guard | guarded apply exited nonzero before mutation |
| Unsafe apply control | PVC UID changed; the restored 6,220-row ledger was absent on the fresh volume |

Across every integrity check, `checksum_failures=0` and `gaps=0`. The writer
uses `md5(seq || ':t3')`; the kill test terminates a client after INSERT but
before COMMIT, so the verified ledger represents acknowledged commits only.

## P3 charter input

- Persist the expected PVC UID outside the workload PVC. Bootstrap is an
  explicit operation; normal reconcile must fail closed if the claim is
  missing or its UID changed.
- Never include PVC creation in the ordinary guarded apply path. A raw apply
  of the fixture recreated a Bound empty volume without an error.
- Scale to zero and prove pod absence, not only Deployment availability,
  before changing a stateful image.
- Start the database and pass readiness before starting any writer.
- Treat rollback as executable rollback only. Data migrations need their own
  forward-compatible or restore-based policy; A4 forbids claiming that an
  image rollback downgrades persisted format.
- A backup PVC is not a cluster-loss backup. Copy the dump and integrity
  metadata outside the cluster before teardown, then verify row count,
  sequence continuity, and checksums after restore.

## Reproduction

```bash
spike/env/doctor.sh
spike/env/up.sh t3
spike/t3/run.sh pre-teardown
spike/env/down.sh t3
spike/env/up.sh t3
spike/t3/run.sh post-teardown
spike/env/down.sh t3
```

All fixture applies use `kubectl apply --server-side --field-manager=t3` and
all Kubernetes commands pin context `k3d-cpt-t3`.

## Exit checklist

- [x] Managed stop → verify → start preserves a contiguous valid ledger.
- [x] RWO same-node concurrent mount is possible and unsafe.
- [x] RWOP verdict recorded with provisioner and CSI evidence.
- [x] Image rollback preserves the PVC and data; A4 recorded.
- [x] Backup survives full cluster deletion and restores exactly.
- [x] PVC UID guard rejects a missing claim; unsafe control proves silent loss.
- [x] Kill during an in-flight transaction leaves PostgreSQL consistent.
