import { kubeNetworkPolicyName } from './kube-naming';
import type { KubeNetworkPolicyKind } from './kube-naming.types';
import type {
  KubeNetworkPolicyEgressRule,
  KubeNetworkPolicyPort,
  KubeNetworkPolicySelectorRequirement,
  KubeNetworkPolicySpec,
  ProjectNetworkPolicyProjection,
} from './kube-network-policy-projection.types';
import type { KubeManifest } from './kube-runtime.types';

const dnsNamespaceLabels: Readonly<Record<string, string>> = { 'kubernetes.io/metadata.name': 'kube-system' };
const dnsPodLabels: Readonly<Record<string, string>> = { 'k8s-app': 'kube-dns' };
const linkLocalCidr: string = ['169', '254', '0', '0/16'].join('.');
const metadataServiceCidr: string = ['169', '254', '169', '254/32'].join('.');
const privateClassACidr: string = ['10', '0', '0', '0/8'].join('.');
const privateClassBCidr: string = ['172', '16', '0', '0/12'].join('.');
const privateClassCCidr: string = ['192', '168', '0', '0/16'].join('.');
const privateNetworkCidrs: readonly string[] = [privateClassACidr, privateClassBCidr, privateClassCCidr];

export function projectNetworkPolicyManifests(
  namespace: string,
  namespaceId: string,
  projectId: string,
  projection: ProjectNetworkPolicyProjection,
): KubeManifest[] {
  return [
    defaultDenyManifest(namespace, namespaceId, projectId),
    applicationEgressManifest(namespace, namespaceId, projectId, projection),
    productJobEgressManifest(namespace, namespaceId, projectId, projection),
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
    podSelector: { matchLabels: projection.applicationPodLabels },
    policyTypes: ['Egress'],
  });
}

function productJobEgressManifest(
  namespace: string,
  namespaceId: string,
  projectId: string,
  projection: ProjectNetworkPolicyProjection,
): KubeManifest {
  return networkPolicyManifest(namespace, namespaceId, projectId, 'product-job-egress', {
    egress: applicationEgressRules(projection),
    podSelector: { matchExpressions: [productJobSelectorExpression()] },
    policyTypes: ['Egress'],
  });
}

function applicationEgressRules(projection: ProjectNetworkPolicyProjection): KubeNetworkPolicyEgressRule[] {
  return [
    ...(projection.resourcePorts.length === 0 ? [] : [resourceEgressRule(projection)]),
    dnsEgressRule(),
    internetEgressRule(projection),
  ];
}

function resourceEgressRule(projection: ProjectNetworkPolicyProjection): KubeNetworkPolicyEgressRule {
  return {
    ports: tcpPorts(projection.resourcePorts),
    to: [{ podSelector: { matchLabels: projection.resourcePodLabels } }],
  };
}

function dnsEgressRule(): KubeNetworkPolicyEgressRule {
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

function internetEgressRule(projection: ProjectNetworkPolicyProjection): KubeNetworkPolicyEgressRule {
  const except: string[] = [
    metadataServiceCidr,
    linkLocalCidr,
    ...privateNetworkCidrs,
    projection.podCidr,
    projection.serviceCidr,
  ];
  return { to: [{ ipBlock: { cidr: '0.0.0.0/0', except } }] };
}

function applicationIngressManifest(
  namespace: string,
  namespaceId: string,
  projectId: string,
  projection: ProjectNetworkPolicyProjection,
): KubeManifest {
  return networkPolicyManifest(namespace, namespaceId, projectId, 'application-ingress', {
    ingress:
      projection.applicationPorts.length === 0
        ? []
        : [
            {
              _from: [
                {
                  namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': projection.edgeNamespaceName } },
                  podSelector: { matchLabels: projection.edgePodLabels },
                },
              ],
              ports: tcpPorts(projection.applicationPorts),
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
    ingress:
      projection.resourcePorts.length === 0
        ? []
        : [
            {
              _from: [
                { podSelector: { matchLabels: projection.applicationPodLabels } },
                { podSelector: { matchExpressions: [productJobSelectorExpression()] } },
              ],
              ports: tcpPorts(projection.resourcePorts),
            },
          ],
    podSelector: { matchLabels: projection.resourcePodLabels },
    policyTypes: ['Ingress'],
  });
}

function tcpPorts(ports: number[]): KubeNetworkPolicyPort[] {
  return [...new Set(ports)]
    .sort((left: number, right: number): number => left - right)
    .map((port: number): KubeNetworkPolicyPort => ({ port, protocol: 'TCP' }));
}

function productJobSelectorExpression(): KubeNetworkPolicySelectorRequirement {
  return { key: 'compartment.dev/job-class', operator: 'Exists' };
}

function networkPolicyManifest(
  namespace: string,
  namespaceId: string,
  projectId: string,
  policy: KubeNetworkPolicyKind,
  spec: KubeNetworkPolicySpec,
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
