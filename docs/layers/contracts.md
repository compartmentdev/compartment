# Contracts Layer

Owns:

- public DTOs;
- named TypeScript interfaces and types;
- Zod schemas for public payloads;
- shared browser/app-access protocol identifiers such as callback/logout paths, cookie names, and ingress header names;
- tiny pure helpers that operate directly on shared contract DTOs.

May depend on:

- third-party schema tooling only.

Must not:

- import any `@compartment/*` package;
- own DB schema or persistence types;
- use `z.infer`;
- hide public wire types behind implicit inference.

Change checklist:

- keep identifiers explicit and canonical;
- update contract tests and all consumers.
