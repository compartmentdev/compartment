# Private registry node-pull endpoint proof

## Decision

**NO-GO for hard blocker 1 as a portable mechanism.**

The DNS-to-`ClusterIP` mechanism works on the tested multi-node k3s topology
with kube-proxy, and it works behind dnsmasq after the registry DNS zone is
explicitly exempted from rebinding protection. It does not work for the tested
kube-proxy-less Cilium topology: containerd times out connecting to the
registry `ClusterIP`. Enabling `bpf.lbExternalClusterIP` did not repair the
containerd pull in this topology.

The mechanism can proceed only if the initial supported-cluster contract:

1. requires node resolvers to return the private A record, with an operator
   allowlist for resolvers that enforce DNS-rebinding or public-to-private
   answer policy; and
2. excludes kube-proxy-less Cilium until a specific, reproducibly validated
   Cilium configuration or a different canonical private mechanism makes the
   container runtime path work.

## Scope and environment

The proof ran on 2026-07-27 with Docker 29.5.0, k3d 5.8.3, k3s
1.31.5-k3s1, and Cilium 1.19.6. The disposable registry was `registry:2`.
The scripts live in `scripts/proofs/registry-node-pull/`.

This is a network and container-runtime proof, not the product registry
implementation. Repository-scoped authentication, signing, BuildKit, the
DNS-01 broker, and production registry persistence are outside its scope.

## Mechanism

The registry is exposed only by a `ClusterIP` Service on port 443.
Its node-resolvable name is `<dashed-cluster-ip>.sslip.io`; public DNS returns
the Service's private address. The registry serves TLS for that exact name.
There is no registry Ingress, `LoadBalancer`, or insecure HTTP listener. The
fresh-node scan finds no `registries.yaml`, containerd `hosts.toml`, or
generated containerd configuration referencing the proof hostname.

On the kube-proxy topology, kube-proxy programs the node host network so a
node process connecting to the Service `ClusterIP` is translated to a registry
endpoint. The hostname stays stable while Helm retains the Service
`clusterIP`.

Every test image has a timestamped tag and a newly generated layer. Pull Pods
set `imagePullPolicy: Always`. Registry logs must also show containerd
manifest requests. These controls prevent a cached base layer from being
mistaken for a registry pull.

## TLS equivalence and limitation

A public certificate cannot be issued for the generated `sslip.io` hostname,
so the scripts generate a test CA and append it to the disposable k3d node
image trust bundle, then restart k3s so containerd reloads that bundle. This
changes the OS trust store only; it does not configure a registry, mirror, or
containerd endpoint.

In production, the DNS-01 broker obtains a Let's Encrypt certificate for the
managed registry name. Supported node images must already trust the selected
public certificate chain; under that prerequisite, the production path
requires no customer CA installation and no node configuration. The test CA
substitutes only for the pre-existing public trust anchor. This proof validates
hostname, SNI, TLS, and runtime trust after a trust anchor exists. It does not
prove public-root availability on every possible node image or validate Let's
Encrypt issuance; issuance is a separate hard-blocker proof.

## Case A — PASS: kube-proxy, multi-node

Topology: one k3s server and two agents.

The Service was cluster-only and its DNS name encoded the same address:

```text
HOST=10-43-238-57.sslip.io
CLUSTER_IP=10.43.238.57
NAME       TYPE        CLUSTER-IP      EXTERNAL-IP   PORT(S)
registry   ClusterIP   10.43.238.57   <none>        443/TCP
TYPE=ClusterIP CLUSTER_IP=10.43.238.57 EXTERNAL_IPS=
```

All three node resolvers returned `10.43.238.57`, and a TLS registry catalog
request succeeded from a helper sharing each node's network namespace. The
runtime-configuration scan printed only node names: it found no
`registries.yaml` or `hosts.toml`.

The pushed image was unique:

```text
IMAGE=10-43-238-57.sslip.io/test:case-a-20260727145811
PUT /v2/test/manifests/case-a-20260727145811 HTTP/2.0" 201
```

Each node-selected Pod was Running with the same registry digest:

```text
NAME                                        NODE                                   PHASE
pull-k3d-proof-registry-a-agent-0           k3d-proof-registry-a-agent-0           Running
pull-k3d-proof-registry-a-agent-1           k3d-proof-registry-a-agent-1           Running
pull-k3d-proof-registry-a-server-0          k3d-proof-registry-a-server-0          Running

IMAGE_ID
10-43-238-57.sslip.io/test@sha256:8c4910e15ec698dc3d5fa6d75ad5c4631ba29eb81579f70764a604e1eedd2853
```

Registry logs independently show three containerd clients fetching the
manifest, including one request from each node-side source address:

```text
10.42.0.1 ... HEAD /v2/test/manifests/case-a-20260727145811 ... 200 ... containerd/v1.7.23-k3s2
10.42.1.0 ... HEAD /v2/test/manifests/case-a-20260727145811 ... 200 ... containerd/v1.7.23-k3s2
10.42.2.0 ... HEAD /v2/test/manifests/case-a-20260727145811 ... 200 ... containerd/v1.7.23-k3s2
```

An actual Helm upgrade changed a Service annotation while leaving the
Service address unchanged:

```text
before: 10.43.238.57
after:  10.43.238.57
```

Production implication: an in-place chart upgrade must preserve the existing
Service. The proof does not cover uninstall/reinstall. Preserving the
`clusterIP` preserves the derived hostname.

## Case B — PASS with required resolver allowlist

The k3d node's `/etc/resolv.conf` pointed at a dedicated dnsmasq 2.83
container running with `--stop-dns-rebind` and upstream `1.1.1.1`. Without an
exception, the node got an empty answer:

```text
Server:  172.19.0.53
Address: 172.19.0.53:53

Non-authoritative answer:
```

The resolver log proves the query did not bypass dnsmasq:

```text
query[A] 10-43-245-89.sslip.io from 172.19.0.2
forwarded 10-43-245-89.sslip.io to 1.1.1.1
possible DNS-rebind attack detected: 10-43-245-89.sslip.io
```

After restarting dnsmasq with `--rebind-domain-ok=/sslip.io/`, the same node
resolver returned the Service address:

```text
Name:    10-43-245-89.sslip.io
Address: 10.43.245.89
```

The node-selected Pod then reached Running. Registry logs contain a
containerd `HEAD` and `GET` for the timestamped tag and digest, so the result
was not supplied only by a local image cache.

Supported-matrix and operator wording:

> Node resolvers and upstream corporate DNS must permit the managed registry
> zone to return private or cluster-address A records. dnsmasq with
> `--stop-dns-rebind`, and equivalent rebinding or public-to-private DNS
> policies, require an explicit zone allowlist. Detect a missing allowlist by
> resolving the registry's public name from every eligible node; NXDOMAIN or
> an empty answer where authoritative/public DNS returns the private A record
> is unsupported until the operator adds the exception.

This proof did not run a separate systemd-resolved case or a representative
corporate DNS appliance. Those explicit Stage 5 coverage items remain open.
Operator guidance is to test the observed answer on every node rather than
infer support from a resolver implementation name: systemd-resolved can still
surface rejection by its configured upstream DNS or local policy.

## Case C — FAIL: kube-proxy-less Cilium

Topology: one k3s server with kube-proxy disabled, flannel disabled, and
network policy disabled; Cilium 1.19.6 used
`kubeProxyReplacement=true` and `socketLB.enabled=true`.

Configuration evidence:

```text
kube-proxy daemonset: ABSENT
KubeProxyReplacement: True
Socket LB:            Enabled
Socket LB Coverage:   Full
10.43.149.7:443/TCP  ClusterIP  1 => 10.0.0.149:443/TCP (active)
```

The node resolver returned the correct `10.43.149.7` answer. A `crane
catalog` helper sharing the node network namespace reached `/v2/` with TLS
and returned status 0. The different containerd result is consistent with a
process/cgroup-specific socket-LB attachment difference, but this proof does
not isolate that as the exact cause. It does establish that a helper merely
sharing the node network namespace is not a sufficient kubelet viability
check.

To avoid circularly depending on the failing Service path, the script seeded
the unique image from an in-cluster crane Pod using the registry Pod IP while
preserving the TLS hostname. The subsequent kubelet pull used only the public
hostname and therefore the `ClusterIP`. It failed:

```text
pull-k3d-proof-registry-c-server-0   0/1   ErrImagePull
Failed to pull image "10-43-149-7.sslip.io/test:case-c-20260727145114":
Head "https://10-43-149-7.sslip.io/v2/test/manifests/case-c-20260727145114":
dial tcp 10.43.149.7:443: i/o timeout
```

The proof then upgraded Cilium with `bpf.lbExternalClusterIP=true`, captured
`bpf-lb-external-clusterip: "true"` in the rendered Cilium ConfigMap and
captured post-rollout running-agent status, and retried. Cilium reported
healthy kube-proxy replacement, but a new `Always` pull failed with the same
timeout. That flag alone is therefore not a validated mitigation for
k3d/k3s containerd in this topology.

Possible follow-up mechanisms, none approved by this proof, are a
Cilium-version-specific host-service/cgroup attachment configuration, a
node-reachable private address other than `ClusterIP`, or narrowing the
supported topology contract.

## Case D — PASS: every eligible node

- [x] `k3d-proof-registry-a-server-0`: Running
- [x] `k3d-proof-registry-a-agent-0`: Running
- [x] `k3d-proof-registry-a-agent-1`: Running

Case A covers 3/3 eligible nodes with separate node selectors and registry
requests. It does not extrapolate from a Pod-network probe or control-plane
node.

## Reproduction and cleanup

Run all cases:

```sh
scripts/proofs/registry-node-pull/run-all.sh
```

Each case writes raw evidence under the ignored local `evidence/` directory,
uses a case-specific cluster name, and deletes only that cluster on exit. Case
B additionally deletes only its named dnsmasq container. The scripts keep one
proof cluster at a time and use an isolated kubeconfig, so another worktree
cannot switch their active context.
