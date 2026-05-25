# Utils Layer

Utils owns small cross-package helpers with no stronger package owner.

- Owns small shared primitives such as string, URL, header, cookie, path, and generic filesystem-boundary helpers.
- Owns shared predicates only when they would otherwise be duplicated across runtime packages.
- Use this layer for helpers with no transport-policy, DTO, DB, or business ownership.
- Prefer small explicit helpers; generic boundary validators are acceptable when they stay package-agnostic.
- Move code here only after it is truly shared; keep package-owned helpers in their current layer.
- May depend on third-party packages only.
- Must not import any `@compartment/*` package.
- Must not become a dump for business logic, DTO helpers, persistence helpers, or layer-specific transport policy.
- Must not own browser or app-access protocol constants, wire DTOs, ingress header names, or layer-specific selectors and invariants.
