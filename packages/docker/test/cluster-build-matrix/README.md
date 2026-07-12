# Opt-in cluster build matrix

This permanent harness validates the P9 cluster builder against every current
example except `railpack-pnpm-workspace/web`, whose Railpack 0.30.1 `pnpm: not
found` incompatibility is documented by T4. It also verifies immediate invalid
Dockerfile failure and recovery, two concurrent builds, pushed digests and SBOM
attestation manifests, persistent volumes across BuildKit and registry restarts,
post-restart cache reuse, NetworkPolicy connectivity, and BuildKit resource
evidence.

It is intentionally outside `pnpm test` and fails closed. Prerequisites:

- an amd64 or arm64 live cluster with the projected bundled BuildKit and registry ready;
- NetworkPolicy enforcement and Metrics Server (`kubectl top` must work);
- cluster-owned probe pods with `nc`: the selected worker, an unselected pod in
  the selected worker namespace, and a pod in an unselected namespace;
- the required probe pod names/namespaces and an RFC1918 denied target supplied
  through the `CLUSTER_BUILD_*` variables reported by `run.sh`; the unselected
  namespace probe must be able to reach that target as a negative-test control;
- worker access to BuildKit and local access to the authenticated registry API;
- `kubectl`, `curl`, `jq`, `pnpm`, installed workspace dependencies, and all
  required environment variables reported by `run.sh`;
- `BUILDKIT_ADDR` targeting the cluster BuildKit endpoint;
- `CLUSTER_BUILD_REGISTRY_API_URL` including `http://` or `https://`.

Run from the repository root:

```sh
pnpm --dir packages/docker test:cluster-build-matrix -- \
  <kube-context> <build-namespace> <results-directory>
```

The harness records node architecture, samples BuildKit CPU and memory
throughout the matrix, and collects
evidence suitable for the 2 CPU/2 GiB envelope. It records cgroup throttling
state explicitly because Metrics Server cannot prove throttling behavior. It
does not make cross-architecture timing claims; that comparison remains deferred.
