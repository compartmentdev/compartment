import { createHash } from 'node:crypto';

const dnsLabelMaximumLength: number = 63;

export function kubeNamespaceName(namespaceId: string): string {
  return immutableKubeName('cpt', namespaceId);
}

export function kubeApplicationName(deploymentId: string): string {
  return immutableKubeName('app', deploymentId);
}

export function kubeApplicationIdentityName(environmentId: string, serviceId: string): string {
  return immutableKubeName('app', `${environmentId}-${serviceId}`);
}

export function kubeSecretName(secretId: string): string {
  return immutableKubeName('secret', secretId);
}

export function kubeJobName(jobId: string): string {
  return immutableKubeName('job', jobId);
}

export function kubeNetworkPolicyName(
  namespaceId: string,
  policy: 'application-egress' | 'application-ingress' | 'default-deny' | 'resource-ingress',
): string {
  return immutableKubeName(`np-${policy}`, namespaceId);
}

function immutableKubeName(prefix: string, immutableId: string): string {
  const normalizedId: string = immutableId
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]/g, '-')
    .replaceAll(/-+/g, '-');
  const trimmedId: string = normalizedId.replaceAll(/^-|-$/g, '');
  if (trimmedId.length === 0) {
    throw new Error('Kubernetes names require a non-empty immutable ID.');
  }
  const digest: string = createHash('sha256').update(immutableId).digest('hex').slice(0, 16);
  const readableLength: number = dnsLabelMaximumLength - prefix.length - digest.length - 2;
  const readableId: string = trimmedId.slice(0, readableLength).replace(/-$/, '');
  const name: string = `${prefix}-${readableId}-${digest}`;
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(name)) {
    throw new Error(`Invalid immutable Kubernetes name: ${name}`);
  }
  return name;
}
