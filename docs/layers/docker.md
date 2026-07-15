# Docker Layer

Owns:

- remote `buildctl` invocation for `Dockerfile` and Railpack-backed source image builds;
- command shaping and output parsing for image builds.

May depend on:

- Node built-ins.

Must not:

- own deployment orchestration or rollback policy;
- know about API, CLI, Fastify, or compartment DB models;
- expose test-only dependency bags or override hooks.

Change checklist:

- keep the surface thin and typed;
- hide raw BuildKit and Railpack argv assembly from callers;
- shape results so callers do not depend on current BuildKit implementation details.
