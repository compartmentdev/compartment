# Runtime Variables

This document keeps only the durable decisions behind the shipped runtime-variable system. Exact command surfaces, schemas, and API details belong in contracts and public reference docs.

## Decision

The canonical product noun is `variable`.
Sensitivity is an attribute of a variable, not a separate top-level feature.

## Scope Model

The service runtime model has five effective sources:

1. direct environment variable
2. direct service variable
3. environment variable-group binding
4. service variable-group binding
5. service resource-output binding

The resource runtime model has exactly two effective variable sources:

1. direct resource variable
2. resource variable-group binding

There is no standalone project-level runtime-variable scope.
There is no implicit organization-wide runtime-variable scope.
Organization scope stores reusable variable groups only.
Resources do not inherit environment-scoped or service-scoped variables.

## Ownership Boundary

- Compartment owns runtime-variable storage, binding, precedence, and disclosure policy.
- Git providers and repositories do not own runtime-variable values.
- `compartment.yml` does not own secret values or repo-authored runtime-variable files.
- Literal service-scoped writes may target only existing deployed services.
- Service resource-output bindings may target a service name before the first deploy, as long as the authored
  descriptor declares the service, resource, and output.
- Resource-scoped writes target the resource name in one project environment and may be created before the first
  deploy.

## Sensitivity Model

- Every variable is `plain` or `sensitive`.
- Sensitivity changes operator readback policy, not runtime injection.
- Both classes are encrypted at rest and injected normally at runtime.
- `sensitive` values are write-only after create or update on normal read surfaces.
- The only documented exception is the dedicated local-run path for one subprocess.
- Keys starting with `COMPARTMENT_` are reserved and must never be accepted as app variables.

## Defaults

- Repo-scoped variable commands resolve project from `compartment.yml`.
- Default environment is `production`.
- Default target scope is environment-wide unless the command explicitly narrows to a service or resource.
- `compartment variable run` is the intentional exception and uses a safer local default in its own spec.

## Precedence

Effective winners are deterministic:

1. direct service variable
2. service resource-output binding
3. service variable-group binding
4. direct environment variable
5. environment variable-group binding

Same-level key collisions must fail by default instead of changing winners silently.
Literal service variables and service resource-output bindings for the same key conflict and must be rejected at write
time when possible.
Resource variables have no inherited winners. Direct resource variables override resource variable-group bindings for
the same key.

## Environment Isolation

- Environments do not inherit from each other.
- Inheritance exists only from an environment target to a narrower service target within the same environment.
- Resource targets are isolated from environment and service inheritance.
- Reuse across environments must be explicit through repeated writes or repeated group bindings.

## Security Model

- The database stores ciphertext only, never plaintext.
- Logs, events, deploy metadata, and audit records must never contain raw values.
- Variables are injected at runtime and must not be written into source archives, image layers, or generated files.
- Sensitive values are hidden from general read APIs and CLI output.
- Provenance may expose key names, scope, source, sensitivity, and fingerprints, but not sensitive plaintext.
- The installation-wide variable master key is a control-plane secret and must never enter app runtime variables.

## Encryption Direction

- All runtime variables are encrypted at rest, regardless of sensitivity.
- The intended model is envelope encryption with one installation-wide KEK and per-value DEKs.
- Fingerprints exist for audit and diff behavior without storing plaintext.
- KEK rotation is a control-plane maintenance concern, not a first-class end-user workflow in v1.

## Access Model

- Writes and local plaintext disclosure stay limited to `admin` and `deployer`.
- Metadata-only read surfaces may be broader than value-read surfaces.
- Variable groups are organization-scoped reusable objects.
- v1 stays role-based and does not add a separate variable permission system.
- `compartment variable run` follows the same org-role model and is specified separately.

## Non-Goals

- repo-authored variable manifests;
- automatic organization-wide exposure of reusable groups;
- cross-environment inheritance;
- a second reusable bundle abstraction besides variable groups;
- variable version history or rollback semantics in v1;
- a separate build-only variable or secret system.
