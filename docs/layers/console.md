# Console Layer

Owns:

- the control-plane Vite/React browser bundle;
- browser loaders, route composition, and browser-only view logic;
- browser-only support types and table/query state for the control plane;
- browser unit tests for the control-plane surface.

May depend on:

- `contracts`;
- `utils`.

Must not:

- import `api` internals, route handlers, services, queries, or runtime modules;
- define a second wire-contract layer outside `contracts`;
- own server HTML shells, Fastify route registration, or static file serving.

Structure:

- `src/features/`: page-level loaders, views, and feature-local browser helpers;
- `src/components/`: shared browser UI components only;
- `src/routes/`: browser-local path and error helpers backed by shared `contracts`;
- `src/services/`: browser-owned view-model and table-state types only;
- `src/index.ts`: package runtime helper surface for server-side asset resolution.

Change checklist:

- keep the console bundle importable through `@compartment/contracts/browser` and browser-safe `utils`;
- move shared public paths or query contracts into `contracts`, not into `api`;
- keep server concerns in `api` even when the browser flow uses them.
