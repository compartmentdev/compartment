# Source Archive Layer

The source-archive layer owns the shared source packaging path used by local deploys and Git-source deploy resolution.

## Owns

- Archive planning from `compartment.yml` service paths and `build.include`.
- Ignore-aware source entry selection.
- Symlink-free source tarball capture and generated source-package metadata.

## May depend on

- `contracts`
- `utils`

## Must not

- Depend on `cli`, `worker`, `api`, or other runtime packages.
- Own deploy orchestration, descriptor parsing, or upload flows.
- Broaden source-archive semantics beyond the shared symlink-free archive contract.

## Ownership rules

- Keep archive planning and tar capture on one canonical path for local and Git-source deploys.
- Keep package exports narrow and runtime-owned.
- Keep path and ignore helper types package-local beside the owning services.
