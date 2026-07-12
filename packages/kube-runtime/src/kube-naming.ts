import { immutableKubeName } from '@compartment/utils';

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

export function kubeResourceName(resourceId: string): string {
  return immutableKubeName('resource', resourceId);
}

export function kubeResourceVolumeName(resourceId: string, volumeHandle: string): string {
  return immutableKubeName('volume', `${resourceId}:${volumeHandle}`);
}

export function kubeNetworkPolicyName(
  namespaceId: string,
  policy: 'application-egress' | 'application-ingress' | 'default-deny' | 'resource-ingress',
): string {
  return immutableKubeName(`np-${policy}`, namespaceId);
}
