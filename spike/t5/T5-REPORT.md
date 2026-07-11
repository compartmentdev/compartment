# T5 secrets and RBAC spike

## Result

All 37 checks passed. The raw matrix is in `t5-results.tsv`; it was produced by
`run-scenarios.sh` against the isolated `k3d-cpt-t5` stand.

The two future RBAC artifacts are:

- `bootstrap-rbac.yaml`: a cluster-scoped provisioning identity whose binding
  must be deleted immediately after provisioning;
- `controller-rbac.yaml`: the reusable workload permission set, activated only
  by a namespace-local `RoleBinding` such as `project-a-binding.yaml`.

No production or seeded principal receives either role by default. A fresh
install must provision the bootstrap identity explicitly and create one
controller binding per project namespace. Existing projects need an explicit
backfill or opt-in. BYO permissions remain explicit.

## Permission matrix

| Who                              | Operation                                           | Scope                  | Expected  | Actual    |
| -------------------------------- | --------------------------------------------------- | ---------------------- | --------- | --------- |
| controller A                     | create Deployment, Secret                           | project-a              | allowed   | allowed   |
| controller A                     | create Service, Job, NetworkPolicy; get pods/log    | project-a              | allowed   | allowed   |
| controller A                     | create Deployment or Secret                         | project-b              | forbidden | forbidden |
| controller A                     | create Deployment                                   | platform-ns            | forbidden | forbidden |
| controller A                     | create Namespace or ClusterRoleBinding              | cluster                | forbidden | forbidden |
| bootstrap                        | create Namespace, ServiceAccount, Role, RoleBinding | provisioning scopes    | allowed   | allowed   |
| bootstrap                        | bind `compartment-controller`                       | cluster role name only | allowed   | allowed   |
| bootstrap                        | create ClusterRole or ClusterRoleBinding            | cluster                | forbidden | forbidden |
| bootstrap                        | create Deployment or read Secret                    | project-a              | forbidden | forbidden |
| bootstrap after binding deletion | create Namespace                                    | cluster                | forbidden | forbidden |
| workload user                    | get own or foreign Secret through RBAC              | project-a/project-b    | forbidden | forbidden |
| workload pod                     | call own or foreign Secret API without a token      | cluster API            | 401/403   | 401       |

The controller also performed real create requests, not only SubjectAccessReview
checks. The full negative-first `kubectl auth can-i` and real-request results are
in `t5-results.tsv`.

## D28 verdict

Vanilla Kubernetes RBAC has no namespace-label selector and cannot express
"namespaces created by this identity". `managed-by=compartment` is therefore a
provisioning invariant, not an authorization predicate. Controller isolation is
provided by placing a `RoleBinding` only in each managed project namespace.

The bootstrap credential necessarily has cluster-wide `create namespaces` and
can create its permitted RBAC objects in any existing namespace. It must be
short-lived and used only during project provisioning. The runner deletes its
ClusterRoleBinding immediately after the boundary probes and confirms that
namespace creation is then forbidden. `automountServiceAccountToken: false`
does not revoke RBAC by itself; binding deletion is the required lifecycle step.

Kubernetes also rejects a new RoleBinding when its creator cannot bind the
referenced permissions. To avoid giving bootstrap broad workload permissions or
the dangerous `escalate` verb, the working design preinstalls the controller
`ClusterRole` and grants bootstrap `bind` only for the exact
`compartment-controller` resource name. A namespace-local RoleBinding keeps the
resulting workload authority namespace-scoped.

## T2 mitigation

The workload ServiceAccount and Pod both set
`automountServiceAccountToken: false`. No token file exists under
`/var/run/secrets/kubernetes.io/serviceaccount/`. Unauthenticated calls to
`kubernetes.default` returned 401 for both own-namespace and foreign-namespace
Secret paths. NetworkPolicy is not treated as Kubernetes API isolation.

## Secrets encryption verdict

Without encryption, a consistent copy of `state.db` plus its WAL contained the
unique Secret value in plaintext. The runner then recreated the same T5 cluster
with:

```text
--k3s-arg '--secrets-encryption@server:*'
```

The same value was absent from the encrypted datastore snapshot. K3s reported
`Encryption Status: Enabled`. This
encrypts Kubernetes Secret resources at rest in the datastore. It does not
encrypt values after they are delivered into Pod environment, files, or process
memory. Existing clusters enabled later must follow the k3s enable/restart and
reencryption flow; fresh cluster creation with the flag was used here because it
is deterministic in k3d.

## Rotation

- Updating the Secret and deleting the Pod produced a replacement Pod with the
  new value.
- Updating the Secret and changing the Pod-template checksum annotation created
  a new Pod automatically; the replacement read the checksum-phase value.

## Reproduction

```bash
spike/env/doctor.sh
spike/env/up.sh t5
spike/t5/run-scenarios.sh k3d-cpt-t5
spike/env/down.sh t5
```

All commands in the runner use the explicit `k3d-cpt-t5` context. Datastore
snapshots are temporary and are not committed.
