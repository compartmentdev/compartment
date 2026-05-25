# Type Placement

Use this document as the durable ownership policy for types. It defines who owns a type and where it belongs conceptually, not a filename catalog.

## Core Rules

- Put types in the owning layer or package. Do not create generic shared buckets just because a type is reused.
- If a type crosses a package or process boundary as serialized data, it belongs in `contracts`.
- Keep mapping types and presenters at the boundary layer that translates them.
- Keep pure shared primitives tiny and clearly owned. If business or transport meaning appears, move the type to the real owner.
- One invariant, selector, or support type should have one owner. Do not duplicate it across packages.

## Ownership Boundaries

- `contracts` owns wire DTOs, schemas, and machine-readable shared payloads.
- Route layers own request parsing, auth projection, response shaping, and presenters.
- Query layers own DB row shapes, query selections, and persistence mutation inputs.
- Service layers own orchestration inputs, outputs, plans, and service-local support types.
- CLI command layers own argument parsing and command-local output shaping; CLI services own orchestration over the SDK.
- Console owns browser-only view models and UI state, not server DTOs or session persistence contracts.
- SDK owns transport concerns only. It must not introduce a second DTO layer.
- `source-archive` owns archive-builder inputs and results plus ignore-aware path selection support types for source capture.
- Runtime packages such as `node`, `worker`, and `docker` own their runtime and adapter-local types, not shared business contracts.
- `utils` and `test-support` are for tiny package-owned helpers, not overflow storage.

## Placement Guidance

- Keep route handlers thin and keep route presenters beside the route owner.
- Keep query types beside queries and service types beside services.
- Cross-feature route presenters are acceptable only when they are genuinely route-layer shared; do not create ad hoc shared route buckets.
- Package-level support types are acceptable only when they are truly package-owned and not feature-owned.

## Hard Bans

- No generic `src/types/` buckets.
- No `routes/shared/` dumping ground.
- No moving DB, runtime, or orchestration types into `contracts` just because multiple packages import them.
- No contract `Response` or summary DTOs flowing out of services as service-owned results.
