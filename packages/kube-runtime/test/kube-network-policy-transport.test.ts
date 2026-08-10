import { describe, expect, it } from 'vitest';
import { projectNetworkPolicyManifests } from '../src/kube-network-policy-projection';
import type { ProjectNetworkPolicyProjection } from '../src/kube-network-policy-projection.types';
import { applyObject } from '../src/kube-runtime-operations';
import type { KubeManifest } from '../src/kube-runtime.types';
import { CapturingKubernetesObjectApi } from './kube-transport-capture.harness';
import type { SerializedIngressRule, SerializedNetworkPolicy } from './kube-network-policy-transport.test.types';

const podCidr: string = ['10', '42', '0', '0/16'].join('.');
const serviceCidr: string = ['10', '43', '0', '0/16'].join('.');
const edgePodLabels: Readonly<Record<string, string>> = { 'app.kubernetes.io/component': 'proxy' };

describe('NetworkPolicy transport', (): void => {
  it('sends every ingress peer that opens a port to the Kubernetes API server', async (): Promise<void> => {
    const applied: SerializedNetworkPolicy[] = await applyPolicies();

    const openedRules: SerializedIngressRule[] = applied
      .flatMap((policy: SerializedNetworkPolicy): SerializedIngressRule[] => policy.spec.ingress ?? [])
      .filter((rule: SerializedIngressRule): boolean => (rule.ports ?? []).length > 0);

    expect(openedRules).toHaveLength(2);
    for (const rule of openedRules) {
      expect(rule.from ?? []).not.toHaveLength(0);
    }
  });

  it('serializes the application ingress peer onto the Kubernetes wire contract', async (): Promise<void> => {
    const applied: SerializedNetworkPolicy[] = await applyPolicies();

    const rule: SerializedIngressRule = requireIngressRule(applied, 'application-ingress');
    expect(rule.from).toEqual([
      {
        namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': 'platform' } },
        podSelector: { matchLabels: edgePodLabels },
      },
    ]);
    expect(rule).not.toHaveProperty('_from');
  });

  it('serializes the resource ingress peers onto the Kubernetes wire contract', async (): Promise<void> => {
    const applied: SerializedNetworkPolicy[] = await applyPolicies();

    const rule: SerializedIngressRule = requireIngressRule(applied, 'resource-ingress');
    expect(rule.from).toEqual([
      { podSelector: { matchLabels: { app: 'application' } } },
      { podSelector: { matchExpressions: [{ key: 'compartment.dev/job-class', operator: 'Exists' }] } },
    ]);
  });
});

async function applyPolicies(): Promise<SerializedNetworkPolicy[]> {
  const manifests: KubeManifest[] = projectNetworkPolicyManifests('cpt-project', 'project', 'project', projection());
  const applied: SerializedNetworkPolicy[] = [];
  for (const manifest of manifests) {
    const objectApi: CapturingKubernetesObjectApi = new CapturingKubernetesObjectApi(
      `/apis/networking.k8s.io/v1/namespaces/cpt-project/networkpolicies/${manifest.metadata?.name ?? ''}`,
    );
    await applyObject(objectApi, manifest, false);
    applied.push(JSON.parse(objectApi.body ?? '{}') as SerializedNetworkPolicy);
  }
  return applied;
}

function requireIngressRule(applied: SerializedNetworkPolicy[], policy: string): SerializedIngressRule {
  const found: SerializedNetworkPolicy | undefined = applied.find((candidate: SerializedNetworkPolicy): boolean =>
    candidate.metadata.name.startsWith(`np-${policy}-`),
  );
  const rule: SerializedIngressRule | undefined = found?.spec.ingress?.[0];
  if (rule === undefined) {
    throw new Error(`Expected the applied ${policy} policy to carry an ingress rule.`);
  }
  return rule;
}

function projection(): ProjectNetworkPolicyProjection {
  return {
    applicationPodLabels: { app: 'application' },
    applicationPorts: [8080],
    edgeNamespaceName: 'platform',
    edgePodLabels,
    podCidr,
    resourcePodLabels: { app: 'resource' },
    resourcePorts: [5432],
    serviceCidr,
  };
}
