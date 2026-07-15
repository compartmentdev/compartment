# Stateful Resources

Status: implemented v1
Updated: 2026-05-25

## Decision

`resources` is the only public descriptor noun for persistent internal runtime resources.
In v1, every resource is a Kubernetes-backed stateful workload, but `stateful` is behavior, not a public namespace.

## Model

- `services` and `resources` coexist in one `compartment.yml`, but remain separate lifecycle objects.
- `services` are deployable app code.
- `resources` are persistent internal runtime dependencies reconciled before app deploys.
- Resource backup and restore are shipped resource operations. The descriptor owns operation intent; the platform owns
  backup records, artifacts, retention cleanup, restore execution, and restore state.
- v1 keeps `services` required and non-empty; resource-only projects are out of scope.

## Invariants

- Resource names share the service-name schema and must not collide with service names.
- v1 supports exactly one resource kind and does not expose `kind` or `type`.
- `image` is required.
- Resources may use literal descriptor env values for non-secret static config.
- Resource secrets and per-resource runtime config live in the variable store under the resource target.
- Internal ports are Service-only. Host publish and public ingress are forbidden.
- Volume handles are stable per-resource identities. Existing handles may not be remapped to new mount paths.
- Readiness is optional; v1 supports `tcp` only.

## Ownership Boundary

The descriptor owns:

- resource identity;
- workload image, command, ports, volumes, and generic readiness;
- literal env wiring for non-secret static config.
- derived resource outputs, including generated connection strings that reference resource metadata, project and
  environment names, and resource-scoped variables.
- resource operation definitions for backup and restore commands, operation image/env overrides, backup schedules, and
  retention policy.

The descriptor does not own:

- secret values;
- resource-scoped variable values;
- generated credentials or resolved output plaintext;
- public ingress;
- backup records, artifact locations, manifests, retention deletion state, or restore execution state;
- database-specific lifecycle beyond declared resource operation commands and shipped presets;
- managed HA semantics.

## Reconciliation Rules

- `compartment deploy` reconciles declared resources before queuing app deployments.
- Unchanged resources remain ready.
- Runtime-definition changes that affect process shape recreate the resource with existing volumes attached.
- Recreate is stop-before-start only; side-by-side candidate rollout is invalid for shared persistent volumes.
- App deploys must wait for required resource reconciliation to succeed.
- Backup and restore commands are runtime operations over reconciled resources. They must not change normal deploy
  reconciliation into implicit data deletion, migration, or restore.

## Data Safety

- Removing a volume from YAML must not delete remote data and should fail with a migration message.
- Removing a resource from YAML must not delete the remote resource during deploy.
- Deleting a resource or its data is always an explicit destructive action outside normal deploy reconciliation.
- In-place restore is an explicit destructive resource operation and must create a pre-restore backup before applying
  the selected backup.
- Restore-to-new-resource is an explicit operation that creates a separate resource outside `compartment.yml`; later
  deploys must require the operator to declare or delete that resource.

## Security And Exposure

- Resources are internal-only.
- v1 must not expose resources through public routes, hosted domains, or TCP ingress.
- The runtime-variable system remains the only secret source; v1 does not add a second secret store.
- Resource generated variables are deploy-time resource intent. Creating a missing generated variable is authorized by
  `deployment.create`, not by adding a new variable permission. Existing and fresh seeded roles keep the same rollout:
  `admin` and `deployer` can trigger generation during deploy, and no migration is required.
- Resource outputs are derived values. Sensitive outputs are hidden by default, explicit reveal requires variable
  disclosure permission, and resolved plaintext must not be persisted.

## Non-Goals

- provider-native backup services or provider-specific lifecycle contracts;
- password rotation, upgrades, replicas, poolers, or HA;
- automatic deletion of resources or volumes when YAML stops declaring them.
