# CLI Layer

CLI owns the command-facing runtime over `sdk`.

- Owns command UX, local config store, output shaping, and orchestration.
- Owns self-hosted host service installation for `compartment-node-agent`.
- Commands stay thin: parse args, validate boundary input, call application code, format output.
- Shared CLI context belongs in store or context helpers, not per-command duplication.
- Services may orchestrate CLI flows, but CLI must not hide behavior behind interface-only service wrappers.
- May depend on `contracts`, `sdk`, `source-archive`, and `utils`; may depend on `node` only to package the `compartment-node-agent` host binary entrypoint.
- Self-hosted install/update may stage root-owned host files and systemd units, but must keep secrets in `/etc/compartment/.env.self-hosted`, not in unit files.
- Must not call DB code or API internals directly.
- Organization resolution uses one canonical identifier only.
