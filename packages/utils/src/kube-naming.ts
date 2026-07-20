import { createHash } from 'node:crypto';

const dnsLabelMaximumLength: number = 63;
const generatedPodSuffixLength: number = 5;

export function kubeResourceServiceDns(resourceId: string, namespaceId: string): string {
  return `${immutableKubeName('resource', resourceId)}.${immutableKubeName('cpt', namespaceId)}.svc`;
}

export function kubeResourcePodNamePrefix(resourceId: string): string {
  return `${immutableKubeName('resource', resourceId)}-`.slice(0, dnsLabelMaximumLength - generatedPodSuffixLength);
}

export function immutableKubeName(prefix: string, immutableId: string): string {
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
