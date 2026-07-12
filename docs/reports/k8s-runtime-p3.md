# Kubernetes runtime P3 resource lifecycle

## Safety contract

- `ReadWriteOnce` is storage topology, not writer fencing. Resource updates use stop, observed pod absence, PVC UID verification, start, and readiness verification.
- Ordinary reconcile projects only Secret, Deployment, and Service. PVC creation is an explicit bootstrap operation and persists the bound claim UID outside the workload volume.
- A missing expected UID, missing or unbound claim, changed UID, or changed handle mapping fails before Deployment mutation. An empty replacement volume is never accepted as recovery.
- Resource Deployments use `Recreate`, one replica, immutable resource and volume names, and the same PVC after executable rollback. Rollback does not claim to reverse data format changes.
- Connection outputs derive their host from the immutable Service DNS: `<resource-service>.<project-namespace>.svc`.
- Backup and restore reuse the durable P4 Job protocol and mount only the per-resource backup artifact PVC. The worker verifies its persisted UID before starting a Job.
- A second durable Job uses the platform worker image to hash sorted relative paths and file bytes, persists checksum and size after backup, and verifies both before a restore command starts.

## Negative controls retained

Permanent projection tests prove that ordinary reconcile cannot contain a PVC, replacement claim UIDs are rejected, an unbound or missing claim is rejected, and a terminating pod is not treated as absent. Golden YAML locks the `Recreate` strategy, single replica, stable data references, and bootstrap-only data and artifact claims. Product Job tests cover mount persistence, artifact UID verification, strict verifier metadata, backup checksum/size capture, and restore mismatch rejection before the user Job.

The live Kubernetes backup → resource removal → restore scenario remains part of the final smoke pass; this report does not use unit coverage as cluster-loss evidence.

## Cutover delete list

After the Kubernetes resource path owns production traffic, delete:

- node `runtime-resource-*` Docker volume and resource-network plumbing;
- the legacy resource runtime path in API and worker;
- stored resource hostnames as runtime truth after all output readers derive Service DNS.

Do not remove these in the additive P3 change.

## Coordination removed

The controller no longer relies on scheduler timing, Deployment availability, or RWO attachment behavior to prevent two writers. One durable state machine owns the stop/absence/UID/start boundary, and the P4 Job mechanism owns backup and restore execution.
