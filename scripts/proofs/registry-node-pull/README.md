# Registry node-pull proof

These scripts reproduce the Phase 0 proof for a private, TLS-protected registry
hostname whose public DNS answer is the registry's cluster-only `ClusterIP`.
They never create an Ingress or `LoadBalancer` and never configure a container
runtime registry mirror.

## Prerequisites

- Linux with Docker 29.5, k3d 5.8.3, kubectl, Helm, OpenSSL, and tar
- at least 15 GB RAM
- outbound access to Docker Hub, `gcr.io`, `helm.cilium.io`, and `sslip.io`

Run every case, one disposable cluster at a time:

```sh
scripts/proofs/registry-node-pull/run-all.sh
```

Run one case:

```sh
scripts/proofs/registry-node-pull/case-a.sh
scripts/proofs/registry-node-pull/case-b.sh
scripts/proofs/registry-node-pull/case-c.sh
```

Evidence is written below `scripts/proofs/registry-node-pull/evidence/`. Set
`EVIDENCE_DIR` to keep it elsewhere. Every case deletes only its own named k3d
cluster on exit. Case B also deletes only its own dnsmasq container.

Each pull uses an `Always` pull policy and a timestamped image containing a
fresh layer. The scripts require registry request logs as separate evidence, so
a locally cached base-image layer cannot produce a false positive.

The proof CA is copied into the disposable k3d node image trust stores. This
models a production certificate rooted in the public Web PKI; it is not a
containerd registry configuration. Production uses a Let's Encrypt certificate
issued through DNS-01, whose root is already in normal node trust stores.
