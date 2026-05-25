# Edge Layer

Owns:

- the internal app-access service behind the public ingress;
- hosted app callback, logout, and `forward_auth` authorization behavior;
- local edge snapshot state for app routes, memberships, and app sessions.

May depend on:

- `contracts`;
- `sdk`;
- `utils`.

Must not:

- own DB access or durable persistence;
- own release/build/deploy orchestration;
- call hidden runtime adapters directly;
- depend on `api` internals instead of the typed internal HTTP surface.

Change checklist:

- keep app-access decisions and callback/logout flow inside `edge`;
- keep access decisions local to the edge snapshot state;
- let `api` remain the source of truth for access state and session revocation;
- do not reintroduce public app traffic or compartment-host proxying into `edge`.
