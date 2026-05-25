# Static Service Spec

Status: shipped
Updated: 2026-05-08

This document records the lasting product contract for `kind: static` in `compartment.yml`. The shipped model is a service-level static type inside the normal multi-service project shape, not a separate project mode.

## Decision

The canonical public noun is `static service`.

- The feature is modeled as `kind: static` on a service.
- `build.outputDirectory` is the required publish contract.
- Static hosting stays inside the existing deploy/runtime lifecycle instead of introducing a separate static platform.

## Product Invariants

- `kind: static` requires object form with `path` and `build.outputDirectory`.
- `build.outputDirectory` must be a non-empty relative path inside `service.path`.
- Static services are deployable and routable like other browser-facing services.
- `accessMode` follows the normal browser-facing service model.
- Build-time configuration uses `build.env`; browser-visible values must be baked into the built output.

## Boundaries

- `kind: static` uses the Railpack-backed static publish path, even when `build.strategy` is omitted.
- The public contract is "build source, publish this directory", not "run an arbitrary user-authored container".
- `release`, `run`, and `readiness` are not allowed for static services in v1.
- `build.strategy: dockerfile` is not allowed for `kind: static` in v1.
- Cross-service browser routing remains in `compartment.routes.yml`, not in a second static-specific routing DSL.

## Runtime Direction

- Deploy still produces an internal immutable serving image.
- Promote, rollback, start, and stop reuse the same stored serving image model as other deployable services.
- Logs come from the serving container; there is no separate asset-log product.
- Runtime HTML or asset templating is not part of the contract.

## Non-Goals

- No project-level `type: static`.
- No object-storage-only or CDN-only runtime in v1.
- No user-authored serving Dockerfile for `kind: static` in v1.
- No SSR, ISR, edge functions, or parallel static-header DSL in v1.
