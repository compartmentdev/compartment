# P9 Kubernetes Build Pipeline Report

## Result

P9 adds the additive cluster build projection and permanent cluster harness. It
does not add or import a Helm chart, wire the later production controller
cutover, or claim an unrun live-cluster result. The worker uses the existing
remote BuildKit client, limits each build batch to two concurrent builds,
requires a digest-pinned push result, and prunes the cache after every settled
batch.

The dedicated build namespace uses Pod Security `enforce=privileged` with
`audit=baseline` and `warn=baseline`. It is not baseline-compatible. The
BuildKit pod keeps the exact T4 minimum: `fsGroup` 1000, seccomp Unconfined,
privilege escalation enabled, AppArmor Unconfined, a read-only root filesystem,
and UID/GID 1000. NetworkPolicy defaults the namespace to deny and opens only
the selected worker-to-BuildKit, DNS, base-image, and registry paths.

The bundled registry and BuildKit cache are persistent. BuildKit receives an
8 GiB PVC and GC retains records newer than 24 hours while targeting 2 GiB.
The exact prune command runs after a worker batch and from a daily CronJob:

```text
buildctl prune --all --keep-duration 24h --keep-storage 2000
```

Application pods receive a deterministic namespace-local
`kubernetes.io/dockerconfigjson` Secret through the existing P5 Secret
projection and reference it through `imagePullSecrets`. External registry mode
omits the bundled registry manifests and uses one explicit registry endpoint,
credential Secret, port, and egress CIDR.

## Image integrity and retention

Build results remain digest-pinned and continue through the existing rollback
retention policy. BuildKit publishes an SBOM as an OCI attestation beside the
image in the selected registry. P9 does not add public keyless Sigstore or an
external signing dependency. Keyed cosign signing and verify-before-rollout are
deferred to the F2 enterprise supply-chain track.

## Evidence and deferred checks

Package tests lock the exact security context, private Service types, PVC sizes,
NetworkPolicy selectors and exclusions, registry modes, SBOM exporter flags,
digest enforcement, two-build concurrency, failed-build recovery, and both
batch and daily prune policy.

The permanent cluster build matrix is present but was not run in this worktree.
It must build every example except the known
`railpack-pnpm-workspace` Railpack 0.30.1 issue, then prove that an invalid
Dockerfile fails cleanly and the next build succeeds. It must also run two
concurrent builds under the 2 CPU / 2 GiB limit. The node-to-registry pull
roundtrip remains an M-check because kubelet pulls are node-side traffic and
are not proven by pod NetworkPolicy. The rootless/rootful timing comparison
also remains open until repeated on the target arm64 environment; the T4
figures were collected on amd64.

## Rollout and delete list

P9 is additive and projection-only until the integration cutover supplies the
bundle to `KubeRuntime.apply`. It creates no Compartment permission and grants no Kubernetes
authority to existing or seeded principals or groups. Fresh and reconciled
application namespaces receive their pull Secret through the existing P5
provisioning path.

At the atomic Kubernetes cutover, remove the Docker Engine runtime surfaces in
`packages/docker`: `docker-engine-runtime*`, runtime image inspect/pull paths,
`docker-network*`, `docker-network-egress*`, `docker-firewall-backend`, Docker
runtime networking in `packages/node`, and all callers, tests, exports, and
scaffolding. Keep the BuildKit, Railpack, registry-auth, and build-plan client
surfaces. P9 itself does not perform this deletion and adds no compatibility
fallback.
