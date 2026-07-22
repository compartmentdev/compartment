import type {
  KubernetesIngressPortConflict,
  KubernetesKubeconfigFailureReason,
} from './kubernetes-install-preflight.service.types';

export function buildIngressConflictMessage(conflict: KubernetesIngressPortConflict): string {
  return `Ports 80/443 are already taken by Service ${conflict.namespace}/${conflict.name} — the platform's Caddy LoadBalancer will never get an address. On k3s disable Traefik: printf 'disable:\\n  - traefik\\n' >/etc/rancher/k3s/config.yaml && systemctl restart k3s && kubectl -n kube-system delete helmchart traefik traefik-crd. Then retry install.`;
}

export function formatCheckedCandidate(
  path: string,
  displayPath: string,
  configured: boolean,
  reason: KubernetesKubeconfigFailureReason,
): string {
  if (configured) {
    return `$KUBECONFIG (${path}: ${reason})`;
  }
  return `${displayPath} (${reason})`;
}

export function buildMissingKubeconfigMessage(checked: readonly string[]): string {
  const environmentChecked: string = checked.some((value: string): boolean => value.startsWith('$KUBECONFIG'))
    ? ''
    : '$KUBECONFIG (not set), ';
  return `No usable kubeconfig found. Checked: ${environmentChecked}${checked.join(', ')}. If you have a cluster, point KUBECONFIG at it. If not, install one first (e.g. k3s: curl -sfL https://get.k3s.io | sh -s - --disable traefik).`;
}
