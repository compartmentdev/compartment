import type { ProjectNetworkPolicyPorts } from '@compartment/contracts';
import type { ProjectNetworkPolicyProjection } from '@compartment/kube-runtime';

export interface ProjectNetworkPolicyEnvironment {
  COMPARTMENT_EDGE_NAMESPACE: string;
  COMPARTMENT_KUBE_POD_CIDR: string;
  COMPARTMENT_KUBE_SERVICE_CIDR: string;
}

export function projectNetworkPolicy(
  environment: ProjectNetworkPolicyEnvironment,
  ports: ProjectNetworkPolicyPorts,
): ProjectNetworkPolicyProjection {
  return {
    applicationPodLabels: { app: 'application' },
    applicationPorts: ports.applicationPorts,
    edgeNamespaceName: environment.COMPARTMENT_EDGE_NAMESPACE,
    // Caddy proxies to tenant Services. Edge only answers forward_auth subrequests and never dials tenant Pods.
    edgePodLabels: { 'app.kubernetes.io/component': 'caddy' },
    podCidr: environment.COMPARTMENT_KUBE_POD_CIDR,
    resourcePodLabels: { app: 'resource' },
    resourcePorts: ports.resourcePorts,
    serviceCidr: environment.COMPARTMENT_KUBE_SERVICE_CIDR,
  };
}
