# Compartment Helm chart

## Requirements

- Kubernetes 1.30.0 or newer. The chart uses the stable `admissionregistration.k8s.io/v1`
  `ValidatingAdmissionPolicy` API to confine project-bootstrap authority.
- Helm 4.x.
- Installer credentials that can manage the chart's Namespaces, ClusterRoles, ClusterRoleBinding,
  ValidatingAdmissionPolicy, ValidatingAdmissionPolicyBinding, and namespaced resources.

The chart declares its Kubernetes compatibility range in `Chart.yaml`; Helm rejects older clusters before rendering.

## Install

The supported owner-bootstrap flow is `compartment install`. Release CLI binaries bundle the matching chart, install
its `foundation` and `full` stages, wait for the public Console endpoint, create the first owner, and save the new CLI
session. Prepare the values file described below, then run:

```bash
compartment install \
  --values compartment-values.yaml
```

The command prompts for the owner email, organization, and password. Without `--base-domain`, it creates the
foundation release, waits for the Caddy LoadBalancer address, allocates a managed domain, persists the installation
identity, domain allocation, and ingress addresses in a retained Kubernetes Secret, and renders the full release with
managed DNS-01 TLS. Source checkouts do not contain an embedded chart; pass `--chart
./deploy/chart/compartment` when running a source-built CLI.

Retry the command with the same release coordinates when it stops before confirming owner creation. It resumes a
deployed foundation or full release and preserves the install token. Repair or remove Helm releases in failed,
pending, or uninstalled states before retrying. Once the owner exists, the install endpoint is closed; recover the
local session with `compartment login` instead.

For low-level operator recovery, use the chart from the same source release as the image tags you deploy. Set
`platform.startupStage=full`; the `foundation` stage exists for the CLI's initial secret-generating install and for
workflows that must populate the bundled registry before starting the platform.

```bash
helm upgrade --install compartment ./deploy/chart/compartment \
  --namespace compartment \
  --create-namespace \
  --values compartment-values.yaml \
  --rollback-on-failure \
  --wait \
  --wait-for-jobs \
  --timeout 15m
```

At minimum, decide and persist these values:

- `service.caddy.type` and the external ingress or load-balancer configuration; the default is a LoadBalancer on
  external ports 80 and 443 with Caddy listening internally on 8080 and 8443;
- `storage.storageClass` and the PVC sizes under `storage`;
- immutable tags for the platform images;
- the values under `secrets`, supplied through the installation's secret-management workflow.

Managed TLS uses typed `platform.acmeIssuer`, `platform.acmeCaUrl`, `platform.acmeEmail`, and
`platform.managedDomainBrokerUrl` values. The chart owns the ACME issuer and CA defaults; the CLI supplies the owner
email and broker credential. At runtime the token is held by the retained install-state Secret and projected into API
and Caddy with individual Secret references, never a ConfigMap. Helm also stores supplied secret values in its
Kubernetes release revision Secrets, so restrict access to both resource classes. A full public render fails when its
base domain, installation ID, public ingress IP, HTTPS protocol, ACME settings, or external 80/443 ports are invalid or
missing.

For an operator-owned base domain, pass `--base-domain`. Set `platform.publicIngressIpv4` or
`platform.publicIngressIpv6` when the Service is not a LoadBalancer. For Caddy-managed custom certificates, create a
Kubernetes TLS Secret containing `tls.crt` and `tls.key`, then set `platform.tlsMode=custom-cert` and
`customTls.existingSecret=<name>`. Set `platform.acmeEmail` as well; Caddy uses it when issuing on-demand certificates
for tenant custom domains that are not covered by the platform certificate. The same Secret is mounted read-only in
API and Caddy. The chart can also create the Secret from `customTls.certificate` and `customTls.privateKey`, but do not
commit private key material to a values file. Inline material is also retained in Helm release revision Secrets;
prefer `customTls.existingSecret`. After rotating an existing Secret in place, change `platform.rolloutMarker` to
restart API and Caddy so Caddy reloads the certificate.

The `<release>-install-state` Secret has Helm's `keep` resource policy so upgrades, resets, and an uninstall
followed by reinstall with the same namespace and release name reuse the installation ID and managed-domain
allocation. To intentionally abandon that identity and request a new allocation, uninstall the release and delete the
Secret selected by both `app.kubernetes.io/instance=<release>` and
`app.kubernetes.io/component=install-state` before reinstalling.

The chart's Caddy Service is the only public entrypoint. It never routes `/internal/*`. Point both
`console.<baseDomain>` and `*.<baseDomain>` at that entrypoint.

## Node registry prerequisite

Application image references use the bundled registry host
`<release-fullname>-registry-auth.<namespace>.svc:5000`. Kubernetes nodes do not resolve Service DNS through cluster
DNS when their container runtime pulls images. Configure every node's container runtime with a mirror or equivalent
route to the bundled registry before deploying applications. This node-level configuration is outside Helm's scope.

The k3d e2e harness configures its k3s `registries.yaml` explicitly; use the corresponding mechanism for your
Kubernetes distribution.
