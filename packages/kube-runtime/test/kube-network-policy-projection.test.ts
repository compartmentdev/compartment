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
  to?: NetworkPolicyPeer[] | undefined;
}

interface NetworkPolicyPort {
  port: number;
  protocol: 'TCP' | 'UDP';
}

interface NetworkPolicyPeer {
  ipBlock?: NetworkPolicyIpBlock | undefined;
  namespaceSelector?: NetworkPolicySelector | undefined;
  podSelector?: NetworkPolicySelector | undefined;
}

interface NetworkPolicyIpBlock {
  cidr: string;
  except?: string[] | undefined;
}

interface NetworkPolicySelector {
  matchLabels?: Record<string, string> | undefined;
}

const linkLocalCidr: string = ['169', '254', '0', '0/16'].join('.');
const metadataServiceCidr: string = ['169', '254', '169', '254/32'].join('.');
const podCidr: string = ['10', '42', '0', '0/16'].join('.');
const privateClassACidr: string = ['10', '0', '0', '0/8'].join('.');
const privateClassBCidr: string = ['172', '16', '0', '0/12'].join('.');
const privateClassCCidr: string = ['192', '168', '0', '0/16'].join('.');
const serviceCidr: string = ['10', '43', '0', '0/16'].join('.');

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

  it.each(['application-egress', 'product-job-egress'] satisfies KubeNetworkPolicyKind[])(
    'blocks RFC1918 networks from %s while preserving DNS and public internet egress',
    (policySuffix: KubeNetworkPolicyKind): void => {
      const manifests: KubeManifest[] = projectNetworkPolicyManifests(
        'cpt-project',
        'project',
        'project',
        projection([8080], [5432]),
      );
      const rules: NetworkPolicyRule[] = readRules(manifests, policySuffix, 'egress');
      const dnsRule: NetworkPolicyRule | undefined = rules.find(
        (rule: NetworkPolicyRule): boolean =>
          rule.ports?.some((port: NetworkPolicyPort): boolean => port.port === 53) === true,
      );
      const internetRule: NetworkPolicyRule | undefined = rules.find(
        (rule: NetworkPolicyRule): boolean => rule.to?.[0]?.ipBlock?.cidr === '0.0.0.0/0',
      );

      expect(dnsRule).toMatchObject({
        ports: [
          { port: 53, protocol: 'UDP' },
          { port: 53, protocol: 'TCP' },
        ],
        to: [
          {
            namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'kube-system' } },
            podSelector: { matchLabels: { 'k8s-app': 'kube-dns' } },
          },
        ],
      });
      expect(internetRule?.to?.[0]?.ipBlock).toEqual({
        cidr: '0.0.0.0/0',
        except: [
          metadataServiceCidr,
          linkLocalCidr,
          privateClassACidr,
          privateClassBCidr,
          privateClassCCidr,
          podCidr,
          serviceCidr,
        ],
      });
    },
  );

  it('preserves application and product-job egress to managed resources', (): void => {
    const manifests: KubeManifest[] = projectNetworkPolicyManifests(
      'cpt-project',
      'project',
      'project',
      projection([8080], [6379, 5432]),
    );

    for (const policySuffix of ['application-egress', 'product-job-egress'] satisfies KubeNetworkPolicyKind[]) {
      expect(readRules(manifests, policySuffix, 'egress')[0]).toEqual({
        ports: [
          { port: 5432, protocol: 'TCP' },
          { port: 6379, protocol: 'TCP' },
        ],
        to: [{ podSelector: { matchLabels: { app: 'resource' } } }],
      });
    }
  });
});

function projection(applicationPorts: number[], resourcePorts: number[]): ProjectNetworkPolicyProjection {
  return {
    applicationPodLabels: { app: 'application' },
    applicationPorts,
    edgeNamespaceName: 'edge',
    edgePodLabels: { app: 'edge' },
    podCidr,
    resourcePodLabels: { app: 'resource' },
    resourcePorts,
    serviceCidr,
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
