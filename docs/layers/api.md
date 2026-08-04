# API Layer

Owns:

- Fastify app and route registration;
- request parsing and response shaping;
- auth/session persistence model;
- DB schema, migrations, and query modules;
- orchestration over Kubernetes runtime state and edge HTTP surfaces;
- control-plane HTML shells, redirects, and static asset serving for the built browser package.

May depend on:

- `contracts`;
- `source-archive`, only to verify the canonical logical digest of an accepted source archive;
- `console`, only to resolve and serve the built control-plane assets from the owning package;
- `sdk`;
- `utils`.

Must not:

- put DB access in routes;
- put HTTP errors in services;
- put business logic in queries;
- fake DI with `SmthDependencies` wrappers for `db` or `config`.

Structure:

- routes: validate input, call concrete functions, map output;
- routes may perform trivial context projection like `request.actor.principalId -> principalId` before calling a service;
- current-organization protected routes resolve `request.currentOrganization` in shared protected hooks; permission checks belong at the resolved organization, project, or environment target;
- services: business logic and orchestration only;
- queries: persistence only;
- http boundary: shared request helpers and one shared error handler.

Auth sessions:

- `Phase 0` user authentication uses opaque bearer session tokens, not JWTs;
- clients send the session token via `Authorization: Bearer <sessionToken>`;
- the API persists sessions in `auth_sessions` and stores only token hashes, not raw tokens;
- session validity is DB-driven through persisted `expiresAt` and `revokedAt` state;
- logout and revoke work by updating server-side session state, so the model is intentionally stateful.

Auth abuse protection:

- public auth or auth-like routes must make an explicit abuse-protection decision in the same change;
- password-, token-, or secret-consuming public auth routes should normally use route throttling plus persistent API-owned cooldown state;
- throttle bookkeeping must not turn a successful auth result or intended business error into `500`.

Change checklist:

- choose the correct owner file first: route, service, query, or runtime;
- do not move browser bundle code, browser-only tests, or React view-model types back into `api`;
- do not add service exports that only unwrap a boundary object and forward to another function;
- if a service starts growing, split it into named helpers early;
- if a new export is used only by tests, remove it or move the test seam.
