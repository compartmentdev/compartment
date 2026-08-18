export function renderK3sConfig(publicAddress: string): string {
  return `cluster-init: true
secrets-encryption: true
write-kubeconfig-mode: "0600"
node-external-ip: "${publicAddress}"
node-label:
  - "compartment.dev/node-pool=data"
etcd-snapshot-schedule-cron: "0 */12 * * *"
etcd-snapshot-retention: 5
kube-apiserver-arg:
  - "feature-gates=ImageVolume=true"
kubelet-arg:
  - "feature-gates=ImageVolume=true"
  - "system-reserved=memory=512Mi"
  - "kube-reserved=memory=512Mi"
  - "eviction-hard=memory.available<512Mi,nodefs.available<10%,imagefs.available<15%,nodefs.inodesFree<5%,imagefs.inodesFree<5%"
`;
}

export function renderManagedVmValues(publicAddress: string): string {
  return `ingress:
  className: traefik
  endpoint:
    type: A
    value: ${publicAddress}
storage:
  storageClass: local-path
sandboxRuntime:
  buildRuntimeClassName: gvisor-build
  runtimeClassName: gvisor
nodePools:
  data:
    nodeSelector:
      compartment.dev/node-pool: data
    tolerations: []
registry:
  issuerRef:
    kind: Issuer
    name: compartment-registry-ca
`;
}

export function renderRegistryIssuer(): string {
  return `apiVersion: cert-manager.io/v1
kind: Issuer
metadata:
  name: compartment-registry-ca
  namespace: compartment
spec:
  ca:
    secretName: compartment-registry-ca
`;
}

export function renderK3sUnitDropIn(): string {
  return `[Unit]
Requires=compartment-firewall.service
After=network-online.target compartment-firewall.service
`;
}
