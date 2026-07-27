# Managed-domain broker DNS-01 proof

This proof exercises pinned k3s v1.33.2-k3s1, cert-manager v1.21.0, Pebble, an allocation-scoped
managed-domain broker, and a minimal cert-manager webhook solver in one disposable
single-node k3d cluster.

Requirements:

- Docker, k3d, kubectl, curl, Python 3, and dig;
- outbound access to pull the pinned images and cert-manager v1.21.0 manifest;
- host TCP/UDP port 1053 and TCP port 19090 available.
- permission to raise `fs.inotify.max_user_instances` temporarily when the host
  limit is below 512; the runner restores the original value on exit.

Run all cases from the repository root:

```bash
scripts/proofs/broker-dns01/run.sh
```

The run replaces only the cluster named `proof-broker-dns01`, writes the latest
evidence under `evidence/`, and leaves the cluster available for inspection.
Remove it with:

```bash
scripts/proofs/broker-dns01/cleanup.sh
```

Set `BROKER_DNS01_CLUSTER_NAME` to use a different proof-owned cluster name.
The harness never contacts the production managed-domain broker.

The proof broker follows four forms:

1. An owner-authorized, idempotent `POST /allocations` reserves a zone and
   returns an allocation ID plus scoped bearer token.
2. `PUT /allocations/:id/targets` binds typed `A`, `AAAA`, and `hostname`
   targets.
3. `POST` and `DELETE /allocations/:id/challenges` present and clean an
   allocation-scoped DNS-01 TXT value.
4. Process startup replays persisted desired targets and active challenges.

The proof-only DNS backend is Pebble's `pebble-challtestsrv`. A NetworkPolicy
allows only the broker Pod to reach its management port; cert-manager calls the
broker webhook, and Pebble plus the host evidence queries use its DNS listener.
The cert-manager release manifest is downloaded from its pinned v1.21.0 release
URL and checked against the SHA-256 embedded in the runner.
