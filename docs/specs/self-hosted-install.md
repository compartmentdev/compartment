# Self-hosted Kubernetes installation

Compartment installs into an existing Kubernetes cluster. The cluster must already provide an Ingress Controller,
default-deny-compatible NetworkPolicy enforcement, persistent storage, and cert-manager. The installer discovers or
accepts one canonical IngressClass, storage class, and public ingress endpoint; it does not install, disable, or mutate
cluster infrastructure.

## Install contract

Run `compartment install` with a kubeconfig whose current context is the intended cluster. Interactive installation
prompts for any required value that cannot be selected unambiguously. Automation supplies the same inputs explicitly:

```bash
KUBECONFIG=./kubeconfig compartment install \
  --kube-context production \
  --namespace compartment \
  --release-name compartment \
  --ingress-class nginx \
  --storage-class fast
```

Use `--ingress-endpoint` only when the selected controller does not publish an address in Ingress status. The value
must be one IPv4 address, IPv6 address, or DNS hostname.

Preflight is read-only except for server-side dry-run validation. It verifies the context, APIs, cert-manager,
IngressClass, storage class, Helm ownership, namespace policy labels, and required access. Installation creates only
release-owned or explicitly retained resources in the selected namespace and supporting tenant namespaces.

## Public routing and TLS

The existing Ingress Controller is the only public entrypoint. The chart renders exact console and application host
rules with no catch-all rule, default backend, or controller-specific annotation. Its Caddy Service is ClusterIP-only
and exposes one internal HTTP port. A NetworkPolicy permits ingress to that port from cluster ingress sources.

Public TLS is owned by the existing Ingress and cert-manager path. `tls.issuerRef` identifies an existing Issuer or
ClusterIssuer. `tls.existingSecret` may reference an operator-provisioned Secret when the selected Ingress contract
requires one; Compartment does not create, copy, or mount operator certificate material.

For an operator-owned system domain:

```bash
compartment system domain set --base-domain apps.example.com --values compartment-values.yaml
compartment system domain verify
compartment system domain activate --values compartment-values.yaml
```

Publish every DNS and ownership record printed by `set`. The operation records the exact issuer reference from the
values file, verifies DNS and Certificate readiness, and commits one retained domain generation. Use
`compartment system domain reset-managed --values compartment-values.yaml` to restore the retained managed allocation.

## Registry and builds

The bundled registry remains a private workload service. Project provisioning creates repository-scoped credentials
and a project-scoped image pull Secret; workloads never share an installation-wide pull identity.

Nodes reach the registry through an operator-provided private hostname and trusted certificate. Compartment does not
change container-runtime configuration, write node files, restart node services, install private certificate
authorities, or provide an external-registry fallback.

Dockerfile, Railpack, BuildKit, and OCI build behavior remains unchanged. NetworkPolicy projections retain tenant
isolation and the explicit RFC1918 egress policy.

## Recovery

Retry `compartment install` with the same release coordinates when it stops before owner creation and the intended
values have not changed. Repair a failed or pending Helm release before retrying. Once the owner exists, use
`compartment login` to recover the local session. Platform replacements are fresh installations in an empty
namespace.

The retained install-state Secret and registry resources use Helm keep policy during installation recovery. Deleting
retained resources is an explicit, operator-owned abandonment action.

### Registry recovery

The registry is a single `Recreate` Deployment backed by one retained `ReadWriteOnce` PVC. Existing running
application Pods are unaffected by a registry outage, but builds, new deployments, and rescheduling an image that is
not cached on the target node remain unavailable until recovery completes.

For an ordinary Pod failure, keep the PVC and restart the Deployment:

```bash
kubectl --context <context> --namespace <namespace> \
  rollout restart deployment/<release>-compartment-registry
kubectl --context <context> --namespace <namespace> \
  rollout status deployment/<release>-compartment-registry --timeout=10m
```

The release gate performs this restart on the two-node ingress-nginx shard and verifies that the PVC UID and the
previously pushed acceptance repository remain unchanged. For a PVC attachment or node failure, first stop new deploy
and build activity. Restore the failed node or use the storage provider's documented detach/reattach procedure. If
the volume cannot be reattached, restore the latest registry backup or VolumeSnapshot into a replacement PVC with the
same `<release>-compartment-registry` name, access mode, StorageClass, and ownership before restarting the Deployment.
Do not delete the retained source PVC until the restored registry has passed integrity checks.

After recovery, require the Deployment to be Available, confirm `/v2/` readiness through the registry-auth path, and
deploy a known project revision so its repository-scoped pull Secret performs a fresh pull on every eligible node.
Keep builds and deploys paused if any manifest or blob is missing; return to the last verified backup instead of
running garbage collection on a damaged store.
