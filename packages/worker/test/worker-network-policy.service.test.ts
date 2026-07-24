import type { ProjectNetworkPolicyPorts } from '@compartment/contracts';
import type { ApplyBundle, KubeManifest, KubeRuntime } from '@compartment/kube-runtime';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  applyResourceNetworkPolicy,
  includeApplicationNetworkPolicyPorts,
  projectProjectNetworkPolicyManifests,
} from '../src/services/worker-network-policy.service';

interface NetworkPolicyRule {
  ports?: NetworkPolicyRulePort[] | undefined;
}

interface NetworkPolicyRulePort {
  port: number;
}

interface NetworkPolicySpec {
  egress?: NetworkPolicyRule[] | undefined;
  ingress?: NetworkPolicyRule[] | undefined;
}

describe('worker NetworkPolicy desired state', (): void => {
  beforeEach((): void => {
    process.env.COMPARTMENT_EDGE_NAMESPACE = 'edge';
    process.env.COMPARTMENT_KUBE_POD_CIDR = ['10', '42', '0', '0/16'].join('.');
    process.env.COMPARTMENT_KUBE_SERVICE_CIDR = ['10', '43', '0', '0/16'].join('.');
  });

  it('projects the current deployment port even when the aggregate payload is stale', (): void => {
    const ports: ProjectNetworkPolicyPorts = includeApplicationNetworkPolicyPorts(
      { applicationPorts: [], resourcePorts: [] },
      [8080],
    );

    expect(
      readPolicyPorts(projectProjectNetworkPolicyManifests('project', ports), 'application-ingress', 'ingress'),
    ).toEqual([8080]);
  });

  it('applies the current resource port for both ingress and application egress', async (): Promise<void> => {
    const apply: Mock = vi.fn(
      async (bundle: ApplyBundle): Promise<KubeManifest[]> => await Promise.resolve(bundle.objects),
    );
    const runtime: KubeRuntime = { apply } as never;

    await applyResourceNetworkPolicy(runtime, 'project', { applicationPorts: [8080], resourcePorts: [] }, [5432]);

    const bundle: ApplyBundle = apply.mock.calls[0]?.[0] as ApplyBundle;
    const manifests: KubeManifest[] = bundle.objects;

    expect(readPolicyPorts(manifests, 'resource-ingress', 'ingress')).toEqual([5432]);
    expect(readPolicyPorts(manifests, 'application-egress', 'egress')).toContain(5432);
  });
});

function readPolicyPorts(
  manifests: KubeManifest[],
  policyNameSuffix: string,
  direction: 'egress' | 'ingress',
): number[] {
  const manifest: KubeManifest | undefined = manifests.find(
    (candidate: KubeManifest): boolean => candidate.metadata?.name?.includes(`np-${policyNameSuffix}`) === true,
  );
  const spec: NetworkPolicySpec = manifest?.spec as NetworkPolicySpec;
  return (spec[direction] ?? []).flatMap(
    (rule: NetworkPolicyRule): number[] => rule.ports?.map((port: NetworkPolicyRulePort): number => port.port) ?? [],
  );
}
