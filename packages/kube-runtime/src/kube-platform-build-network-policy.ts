import { componentLabels } from './kube-platform-build-projection-support';
import type { PlatformBuildProjectionInput } from './kube-platform-build-projection.types';
import type { KubeManifest } from './kube-runtime.types';

const buildkitPort: number = 1234;
const linkLocalCidr: string = ['169', '254', '0', '0/16'].join('.');
const metadataServiceCidr: string = ['169', '254', '169', '254/32'].join('.');
const privateNetworkCidrs: string[] = [
  `${[10, 0, 0, 0].join('.')}/8`,
  `${[172, 16, 0, 0].join('.')}/12`,
  `${[192, 168, 0, 0].join('.')}/16`,
];
const registryPort: number = 5000;

export function platformBuildNetworkPolicies(input: PlatformBuildProjectionInput, namespace: string): KubeManifest[] {
  return [
    networkPolicy(namespace, 'default-deny', {}, { podSelector: {}, policyTypes: ['Ingress', 'Egress'] }),
    buildkitNetworkPolicy(input, namespace),
    pruneNetworkPolicy(input, namespace),
    ...registryNetworkPolicies(input, namespace),
  ];
}

function buildkitNetworkPolicy(input: PlatformBuildProjectionInput, namespace: string): KubeManifest {
  return networkPolicy(namespace, 'buildkit', componentLabels('buildkit'), {
    egress: [dnsEgress(input), publicInternetEgress(input), registryEgress(input)],
    ingress: [
      {
        from: [
          {
            namespaceSelector: { matchLabels: input.workerNamespaceSelector },
            podSelector: { matchLabels: input.workerPodSelector },
          },
        ],
        ports: [{ port: buildkitPort, protocol: 'TCP' }],
      },
    ],
    podSelector: { matchLabels: componentLabels('buildkit') },
    policyTypes: ['Ingress', 'Egress'],
  });
}

function pruneNetworkPolicy(input: PlatformBuildProjectionInput, namespace: string): KubeManifest {
  return networkPolicy(namespace, 'prune', componentLabels('prune'), {
    egress: [
      dnsEgress(input),
      {
        ports: [{ port: buildkitPort, protocol: 'TCP' }],
        to: [{ podSelector: { matchLabels: componentLabels('buildkit') } }],
      },
    ],
    podSelector: { matchLabels: componentLabels('prune') },
    policyTypes: ['Egress'],
  });
}

function registryNetworkPolicies(input: PlatformBuildProjectionInput, namespace: string): KubeManifest[] {
  if (input.registry.mode === 'external') {
    return [];
  }
  return [
    networkPolicy(namespace, 'registry', componentLabels('registry'), {
      ingress: [
        {
          from: [{ podSelector: { matchLabels: componentLabels('buildkit') } }],
          ports: [{ port: registryPort, protocol: 'TCP' }],
        },
      ],
      podSelector: { matchLabels: componentLabels('registry') },
      policyTypes: ['Ingress'],
    }),
  ];
}

function dnsEgress(input: PlatformBuildProjectionInput): object {
  return {
    ports: [
      { port: 53, protocol: 'UDP' },
      { port: 53, protocol: 'TCP' },
    ],
    to: [
      {
        namespaceSelector: { matchLabels: input.dnsNamespaceSelector },
        podSelector: { matchLabels: input.dnsPodSelector },
      },
    ],
  };
}

function publicInternetEgress(input: PlatformBuildProjectionInput): object {
  return {
    ports: [
      { port: 80, protocol: 'TCP' },
      { port: 443, protocol: 'TCP' },
    ],
    to: [
      {
        ipBlock: {
          cidr: '0.0.0.0/0',
          except: [
            metadataServiceCidr,
            linkLocalCidr,
            ...privateNetworkCidrs,
            input.internetEgress.podCidr,
            input.internetEgress.serviceCidr,
          ],
        },
      },
    ],
  };
}

function registryEgress(input: PlatformBuildProjectionInput): object {
  if (input.registry.mode === 'bundled') {
    return {
      ports: [{ port: registryPort, protocol: 'TCP' }],
      to: [{ podSelector: { matchLabels: componentLabels('registry') } }],
    };
  }
  return {
    ports: [{ port: input.registry.port, protocol: 'TCP' }],
    to: [{ ipBlock: { cidr: input.registry.egressCidr } }],
  };
}

function networkPolicy(namespace: string, name: string, labels: Record<string, string>, spec: object): KubeManifest {
  return { apiVersion: 'networking.k8s.io/v1', kind: 'NetworkPolicy', metadata: { labels, name, namespace }, spec };
}
