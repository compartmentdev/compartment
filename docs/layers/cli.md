# CLI Layer

CLI owns the command-facing runtime over `sdk`.

- Owns command UX, local config store, output shaping, and orchestration.
- Does not own production installation or storage lifecycle; Helm and the control plane own Kubernetes resources.
- Commands stay thin: parse args, validate boundary input, call application code, format output.
- Shared CLI context belongs in store or context helpers, not per-command duplication.
- Services may orchestrate CLI flows, but CLI must not hide behavior behind interface-only service wrappers.
- May depend on `contracts`, `sdk`, `source-archive`, and `utils`.
- Must not call DB code or API internals directly.
- Organization resolution uses one canonical identifier only.
