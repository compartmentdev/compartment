# Local Variable Run

Status: implemented
Updated: 2026-04-28

## Decision

`compartment variable run -- <command>` is the dedicated local disclosure path for effective runtime variables.
It reuses the runtime-variable model and does not introduce a second secret surface.

## Security Position

- This command is a controlled disclosure path, not secret isolation.
- The child process receives plaintext values when it needs them.
- The value of the feature is avoiding `.env` files, keeping access role-gated, and auditing each disclosure.
- Sensitive values stay hidden from normal list, show, inspect, deploy-metadata, and browser surfaces.
- Local plaintext delivery is allowed only through a dedicated local-run contract, not through general read APIs.

## Resolution Rules

- Project resolves from `--project` or the nearest valid `compartment.yml`.
- Environment resolves from `--env`, otherwise defaults to `development` for this command only.
- `--service` is optional and may target only an existing service.
- The command must not create projects, environments, or services.

## Scope And Precedence

- Without `--service`, only environment-scoped effective variables are included.
- With `--service`, service-scoped winners are included.
- Effective precedence matches deployed runtime:
  1. direct service variable
  2. service variable-group binding
  3. direct environment variable
  4. environment variable-group binding
- Sensitivity affects disclosure policy and audit requirements, not injection behavior.

## Process Boundary

- The child environment starts from the parent environment with reserved `COMPARTMENT_` keys stripped.
- Resolved compartment variables override parent variables with the same names.
- The CLI runs the child command directly, inherits stdio, and returns the child exit code.
- The CLI must not write plaintext values to disk, logs, shell profiles, or history.

## Production Guard

- `production` is never implicit for local disclosure.
- `--env production` requires `--allow-production`.
- Interactive use should add an explicit confirmation prompt.

## Access Model

- Minimum role is organization `deployer`.
- `admin` is also allowed.
- `readonly` and `viewer` must never receive runtime secrets through this path.
- In v1, authorization is organization-role based; there are no per-variable ACLs.

## API Boundary

- Local-run needs its own authenticated control-plane API route because normal variable reads must keep sensitive values hidden.
- The route belongs only on the protected API surface.
- It must not be exposed through app ingress, `/internal/*`, or internal-token routes.

## Non-Goals

- permanent `.env` syncing;
- child-output masking;
- per-variable ACLs;
- external secret-manager integration;
- changes to deploy, rollback, promote, or build-variable behavior.
