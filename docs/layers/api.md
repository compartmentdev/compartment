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

Signup idempotency keys:

- `POST /v1/auth/signup` requires an `Idempotency-Key` header and stores only its hash, like session tokens;
- the key is the sole proof that a retry belongs to the caller that started the signup, so it must stay unguessable: keep the contract at a random UUID rather than any non-empty string;
- a stored key mints a fresh session for its principal until it expires, so it is a credential and not a request tag; keep its validity window short and its storage hashed;
- claiming an account deletes its key in the same transaction that binds the password: retry-safety only has to reach the caller's first session, and a key that outlived the claim would be a way past the password;
- keys are not swept: a row lives with its principal and is removed by the same cascade.

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
