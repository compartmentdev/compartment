# Compartment YAML

`compartment.yml` is the repo-authored deployment descriptor. It should stay small and stable: enough to describe deployable services and internal resources, but not a second control plane.

## What It Owns

- The repo-to-project slug link.
- The set of deployable services.
- Service-local build, run, access, kind, and readiness hints.
- Internal resource declarations such as image, command, restart behavior, ports, volumes, env wiring, readiness,
  resource outputs, and resource backup/restore operation intent.

## What It Does Not Own

- Secrets or secret values.
- Environment-specific runtime values.
- Hosted domains, ingress policy, or browser-facing rewrites.
- Node placement, deployment history, backup records, backup artifacts, or restore state.
- Public exposure of internal resources.

## Descriptor Invariants

- Authored paths are repo-local and must stay within the repository or worktree boundary.
- Service access mode is a hosted-app hint, not an application auth system.
- Build hints describe how the platform should build; they do not relax platform validation.
- Runtime-start and restart behavior are part of deployment intent and must be explicit enough to reproduce later deployment actions.
- Resource declarations are internal-only infrastructure attached to the project, not deployable public app services.
- Resource operation commands and schedules are descriptor-owned intent. Backup records, artifact retention state, and
  restore execution state remain platform-owned runtime data.

## Build And Runtime Guidance

- Auto-detection may choose the build path, but validation still enforces strategy-specific rules.
- Build-time variable exposure is explicit and allow-listed. Sensitive or missing values fail validation rather than degrading silently.
- Dockerfile and Railpack remain distinct contracts. Features valid for one strategy are not implicitly portable to the other.
- Readiness is an opt-in signal for deployment health, not a substitute for application correctness.

## Rationale

- Keep repo-authored config focused on durable deploy intent.
- Keep secrets, environment state, and ingress policy in platform-owned systems.
- Avoid turning the descriptor into an inventory dump or a second source of runtime truth.
