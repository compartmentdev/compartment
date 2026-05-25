# Docker Layer

Owns:

- remote `buildctl` invocation for `Dockerfile` and Railpack-backed source image builds;
- Docker CLI invocation for runtime image inspect/pull paths;
- command shaping and output parsing for image build/inspect;
- Docker Engine adapter for runtime container run/remove/inspect and log tail;
- namespace-scoped Docker labels for runtime-owned resources;
- typed backend-facing adapter results shared by `worker` and `node`.

May depend on:

- Node built-ins and the single Docker transport client used to avoid reimplementing raw daemon protocols.

Must not:

- own deployment orchestration or rollback policy;
- know about API, CLI, Fastify, or compartment DB models;
- expose test-only dependency bags or override hooks.

Change checklist:

- keep the surface thin and typed;
- hide raw `docker` argv assembly from callers;
- shape results so callers do not depend on current CLI implementation details.
