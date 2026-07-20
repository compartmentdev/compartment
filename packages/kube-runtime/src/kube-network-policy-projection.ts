import { kubeNetworkPolicyName } from './kube-naming';
import type { ProjectNetworkPolicyProjection } from './kube-network-policy-projection.types';
import type { KubeManifest } from './kube-runtime.types';

const dnsNamespaceLabels: Readonly<Record<string, string>> = { 'kubernetes.io/metadata.name': 'kube-system' };
const dnsPodLabels: Readonly<Record<string, string>> = { 'k8s-app': 'kube-dns' };
const linkLocalCidr: string = ['169', '254', '0', '0/16'].join('.');
const metadataServiceCidr: string = ['169', '254', '169', '254/32'].join('.');

export function projectNetworkPolicyManifests(
  namespace: string,
  namespaceId: string,
  projectId: string,
  projection: ProjectNetworkPolicyProjection,
): KubeManifest[] {
  return [
    defaultDenyManifest(namespace, namespaceId, projectId),
    applicationEgressManifest(namespace, namespaceId, projectId, projection),
    applicationIngressManifest(namespace, namespaceId, projectId, projection),
    resourceIngressManifest(namespace, namespaceId, projectId, projection),
  ];
}

function defaultDenyManifest(namespace: string, namespaceId: string, projectId: string): KubeManifest {
  return networkPolicyManifest(namespace, namespaceId, projectId, 'default-deny', {
    podSelector: {},
    policyTypes: ['Ingress', 'Egress'],
  });
}

function applicationEgressManifest(
  namespace: string,
  namespaceId: string,
  projectId: string,
  projection: ProjectNetworkPolicyProjection,
): KubeManifest {
  return networkPolicyManifest(namespace, namespaceId, projectId, 'application-egress', {
    egress: applicationEgressRules(projection),
    podSelector: { matchLabels: { 'compartment.dev/project-id': projectId } },
    policyTypes: ['Egress'],
  });
}

function applicationEgressRules(projection: ProjectNetworkPolicyProjection): object[] {
  return [resourceEgressRule(projection), dnsEgressRule(), internetEgressRule(projection)];
}

function resourceEgressRule(projection: ProjectNetworkPolicyProjection): object {
  return {
    ports: [{ port: projection.resourcePort, protocol: 'TCP' }],
    to: [{ podSelector: { matchLabels: projection.resourcePodLabels } }],
  };
}

function dnsEgressRule(): object {
  return {
    ports: [
      { port: 53, protocol: 'UDP' },
      { port: 53, protocol: 'TCP' },
    ],
    to: [
      {
        namespaceSelector: { matchLabels: dnsNamespaceLabels },
        podSelector: { matchLabels: dnsPodLabels },
      },
    ],
  };
}

function internetEgressRule(projection: ProjectNetworkPolicyProjection): object {
  const except: string[] = [metadataServiceCidr, linkLocalCidr, projection.podCidr, projection.serviceCidr];
  return { to: [{ ipBlock: { cidr: '0.0.0.0/0', except } }] };
}

function applicationIngressManifest(
  namespace: string,
  namespaceId: string,
  projectId: string,
  projection: ProjectNetworkPolicyProjection,
): KubeManifest {
  return networkPolicyManifest(namespace, namespaceId, projectId, 'application-ingress', {
    ingress: [
      {
        from: [
          {
            namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': projection.edgeNamespaceName } },
            podSelector: { matchLabels: projection.edgePodLabels },
          },
        ],
        ports: [{ port: projection.applicationPort, protocol: 'TCP' }],
      },
    ],
    podSelector: { matchLabels: projection.applicationPodLabels },
    policyTypes: ['Ingress'],
  });
}

function resourceIngressManifest(
  namespace: string,
  namespaceId: string,
  projectId: string,
  projection: ProjectNetworkPolicyProjection,
): KubeManifest {
  return networkPolicyManifest(namespace, namespaceId, projectId, 'resource-ingress', {
    ingress: [
      {
        from: [{ podSelector: { matchLabels: { 'compartment.dev/project-id': projectId } } }],
        ports: [{ port: projection.resourcePort, protocol: 'TCP' }],
      },
    ],
    podSelector: { matchLabels: projection.resourcePodLabels },
    policyTypes: ['Ingress'],
  });
}

function networkPolicyManifest(
  namespace: string,
  namespaceId: string,
  projectId: string,
  policy: 'application-egress' | 'application-ingress' | 'default-deny' | 'resource-ingress',
  spec: object,
): KubeManifest {
  return {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'NetworkPolicy',
    metadata: {
      labels: {
        'app.kubernetes.io/managed-by': 'compartment',
        'compartment.dev/namespace-id': namespaceId,
        'compartment.dev/project-id': projectId,
      },
      name: kubeNetworkPolicyName(namespaceId, policy),
      namespace,
    },
    spec,
  };
}
