# T2 NetworkPolicy spike

## Result

Kubernetes NetworkPolicy enforcement works on both tested arm64 stands for
project-to-project isolation, platform isolation, DNS, explicit app/resource
flows, and policy-agent restart. The requested 8x2 exit matrix is not fully
green: two assumptions in the proposed matrix do not hold for either CNI.

- `169.254.169.254` is unreachable before policy in these local clusters, even
  after assigning it and starting a listener on the workload node. A failed
  post-policy request is therefore not proof of enforcement.
- `kubernetes.default` remains reachable through its ClusterIP. Both engines
  evaluate this Service flow after DNAT, so an `ipBlock` exception for the
  Service CIDR does not deny the API endpoint. Standard NetworkPolicy has no
  explicit deny rule that can override an allow.

Do not treat NetworkPolicy alone as sufficient metadata-service or Kubernetes
API isolation. P6/H2 needs a CNI-specific control (for example a Calico policy)
or a platform egress proxy/firewall for those destinations.

## Environment

- Host: macOS arm64; Docker/Colima: aarch64.
- k3d: k3s v1.35.5, flannel plus kube-router v2.10.0 policy-only.
- kind: kind v0.32.0, Kubernetes v1.36.1, Calico v3.32.1, two arm64 nodes.
- Fixtures: `ns-a`, `ns-b`, `platform-ns`; BusyBox 1.37.0.

## Matrix

`PASS` means the observed result matched the row expectation. Row 7 is marked
`LIMIT` because the task explicitly asks whether the API can be blocked.

| Row | Probe | k3d before | k3d policy | Calico before | Calico policy |
| --- | --- | --- | --- | --- | --- |
| 1 | ns-a -> ns-b | allow PASS | deny PASS | allow PASS | deny PASS |
| 2 | ns-a -> 169.254.169.254 | deny **invalid baseline** | deny | deny **invalid baseline** | deny |
| 3 | ns-a -> platform-ns | allow PASS | deny PASS | allow PASS | deny PASS |
| 4 | ns-a -> own resource | allow PASS | allow PASS | allow PASS | allow PASS |
| 5 | caddy -> ns-a app | allow PASS | allow PASS | allow PASS | allow PASS |
| 6 | ns-a -> cluster DNS | allow PASS | allow PASS | allow PASS | allow PASS |
| 7 | ns-a -> kubernetes.default | allow PASS | allow **LIMIT** | allow PASS | allow **LIMIT** |
| 8 | delete policy-agent pod | n/a | no fail-open PASS | n/a | no fail-open PASS |

Raw results are in `k3d-results.tsv` and `calico-results.tsv`.

## Enforcement latency

The harness polls a previously successful ns-a -> ns-b HTTP request after
policy creation, at 100 ms intervals with a one-second request timeout. Both
stands first returned a denial at 1000 ms. This is an upper-bound measurement:
the blocking request timeout dominates the sample resolution.

## Policy details

`policies.yaml.tpl` contains default-deny ingress and egress for `ns-a` and
`ns-b`, plus narrow DNS, caddy-to-app, and app-to-resource rules. The external
egress `ipBlock` excludes link-local, Pod CIDR, and Service CIDR. Omitting the
latter two would allow namespace, platform, and API traffic through the broad
external rule.

The template is rendered by `run-matrix.sh` with the stand CIDRs and is intended
as direct P6 input. `enforcement-check.sh` is the minimal H2 preflight probe: it
first proves connectivity, creates deny-ingress, and fails unless the same
connection becomes blocked.

## Reproduction

```bash
spike/env/up.sh t2
spike/t2/install-kube-router.sh k3d-cpt-t2
spike/t2/enforcement-check.sh k3d-cpt-t2
spike/t2/run-matrix.sh k3d-cpt-t2 10.42.0.0/16 10.43.0.0/16 \
  kube-system k8s-app=kube-router spike/t2/k3d-results.tsv

spike/t2/up-kind-calico.sh
spike/t2/enforcement-check.sh kind-cpt-t2-calico
spike/t2/run-matrix.sh kind-cpt-t2-calico 192.168.0.0/16 10.96.0.0/12 \
  calico-system k8s-app=calico-node spike/t2/calico-results.tsv

spike/env/down.sh t2
spike/t2/down-kind-calico.sh
```

All kubectl operations in the scripts use explicit contexts. Cleanup targets
only `cpt-t2` and `cpt-t2-calico`.
