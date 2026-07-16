# Edge Layer

Owns:

- the internal app-access service behind the public ingress;
- hosted app callback, logout, and `forward_auth` authorization behavior;
- local edge snapshot state for app routes, memberships, and app sessions.
- the last-known-good authorization snapshot format, validation, atomic file I/O,
  and snapshot observability;
- the package-local snapshot storage requirements and workload projection used
  by the Helm chart.

May depend on:

- `contracts`;
- `sdk`;
- `utils`.

Must not:

- own DB access or durable persistence other than the bounded last-known-good
  authorization snapshot;
- own release/build/deploy orchestration;
- call hidden runtime adapters directly;
- depend on `api` internals instead of the typed internal HTTP surface.

Change checklist:

- keep app-access decisions and callback/logout flow inside `edge`;
- keep access decisions local to the edge snapshot state;
- let `api` remain the source of truth for access state and session revocation;
- do not reintroduce public app traffic or compartment-host proxying into `edge`.
- persist authorization metadata only; app sessions and bearer credentials stay
  memory-only;
- keep the snapshot directory `0700`, files `0600`, and reject snapshots older
  than the 24-hour security-policy limit or timestamped in the future.

The Helm installation workflow owns PVC provisioning, StorageClass selection,
encryption at rest, backup inclusion and access, retention, restore, rotation,
and deletion. BYO clusters must select encrypted storage when their security
policy requires it; edge does not implement application-level encryption or
manage storage keys.

Operator guidance must cover StorageClass encryption, backup exposure,
retention, restore, deletion, and the 24-hour fail-closed window.
