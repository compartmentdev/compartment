import { describe, expect, it } from 'vitest';
import { projectNetworkPolicyManifests } from '../src/kube-network-policy-projection';
import { kubeNetworkPolicyName } from '../src/kube-naming';
import type { KubeNetworkPolicyKind } from '../src/kube-naming.types';
import type { KubeManifest } from '../src/kube-runtime.types';
import type { ProjectNetworkPolicyProjection } from '../src/kube-network-policy-projection.types';

interface NetworkPolicySpec {
  egress?: NetworkPolicyRule[] | undefined;
  ingress?: NetworkPolicyRule[] | undefined;
}

interface NetworkPolicyRule {
  ports?: NetworkPolicyPort[] | undefined;
}

interface NetworkPolicyPort {
  port: number;
  protocol: 'TCP' | 'UDP';
}

describe('project NetworkPolicy projection', (): void => {
  it('renders every declared application and resource port in stable order', (): void => {
    const manifests: KubeManifest[] = projectNetworkPolicyManifests(
      'cpt-project',
      'project',
      'project',
      projection([8080, 8080], [6379, 5432, 6379]),
    );

    expect(readRulePorts(manifests, 'application-ingress', 'ingress')).toEqual([[8080]]);
    expect(readRulePorts(manifests, 'resource-ingress', 'ingress')).toEqual([[5432, 6379]]);
    expect(readRulePorts(manifests, 'application-egress', 'egress')[0]).toEqual([5432, 6379]);
    expect(readRulePorts(manifests, 'product-job-egress', 'egress')[0]).toEqual([5432, 6379]);
  });

  it('keeps default deny, DNS, and internet egress while empty port sets allow no workload traffic', (): void => {
    const manifests: KubeManifest[] = projectNetworkPolicyManifests(
      'cpt-project',
      'project',
      'project',
      projection([], []),
    );

    expect(manifests.map((manifest: KubeManifest): string | undefined => manifest.metadata?.name)).toHaveLength(5);
    expect(readRules(manifests, 'application-ingress', 'ingress')).toEqual([]);
    expect(readRules(manifests, 'resource-ingress', 'ingress')).toEqual([]);
    expect(readRules(manifests, 'application-egress', 'egress')).toHaveLength(2);
    expect(readRulePorts(manifests, 'application-egress', 'egress')[0]).toEqual([53, 53]);
    expect(readRules(manifests, 'product-job-egress', 'egress')).toHaveLength(2);
  });
});

function projection(applicationPorts: number[], resourcePorts: number[]): ProjectNetworkPolicyProjection {
  return {
    applicationPodLabels: { app: 'application' },
    applicationPorts,
    edgeNamespaceName: 'edge',
    edgePodLabels: { app: 'edge' },
    podCidr: ['10', '42', '0', '0/16'].join('.'),
    resourcePodLabels: { app: 'resource' },
    resourcePorts,
    serviceCidr: ['10', '43', '0', '0/16'].join('.'),
  };
}

function readRulePorts(
  manifests: KubeManifest[],
  policySuffix: KubeNetworkPolicyKind,
  direction: 'egress' | 'ingress',
): number[][] {
  return readRules(manifests, policySuffix, direction).map(
    (rule: NetworkPolicyRule): number[] => rule.ports?.map((port: NetworkPolicyPort): number => port.port) ?? [],
  );
}

function readRules(
  manifests: KubeManifest[],
  policySuffix: KubeNetworkPolicyKind,
  direction: 'egress' | 'ingress',
): NetworkPolicyRule[] {
  const manifest: KubeManifest | undefined = manifests.find(
    (candidate: KubeManifest): boolean => candidate.metadata?.name === kubeNetworkPolicyName('project', policySuffix),
  );
  const spec: NetworkPolicySpec = manifest?.spec as NetworkPolicySpec;
  return spec[direction] ?? [];
}
