import { describe, expect, it } from 'vitest';
import {
  organizationGlobalCustomQuotaManifests,
  kubeNamespaceName,
  projectNamespaceOrganizationLabelManifest,
  type KubeManifest,
} from '../src';
import type { GlobalCustomQuotaSpec } from '../src/kube-organization-quota-projection.types';

describe('organization GlobalCustomQuota projection', (): void => {
  it('projects five deterministic quotas into one immutable organization namespace pool', (): void => {
    const first: KubeManifest[] = organizationGlobalCustomQuotaManifests({ organizationId: 'org_01jz' });
    const second: KubeManifest[] = organizationGlobalCustomQuotaManifests({ organizationId: 'org_01jz' });

    expect(second).toEqual(first);
    expect(first).toHaveLength(5);
    expect(first.map((manifest: KubeManifest): object | undefined => manifest.spec)).toMatchSnapshot();
    for (const manifest of first) {
      expect(manifest).toMatchObject({
        apiVersion: 'capsule.clastix.io/v1beta2',
        kind: 'GlobalCustomQuota',
        metadata: { labels: { 'compartment.dev/organization-id': 'org_01jz' } },
      });
    }
  });

  it('isolates object names and selectors between organizations', (): void => {
    const first: KubeManifest[] = organizationGlobalCustomQuotaManifests({ organizationId: 'org_a' });
    const second: KubeManifest[] = organizationGlobalCustomQuotaManifests({ organizationId: 'org_b' });
    expect(first.map((manifest: KubeManifest): string | undefined => manifest.metadata?.name)).not.toEqual(
      second.map((manifest: KubeManifest): string | undefined => manifest.metadata?.name),
    );
  });

  it('accounts for ordinary and init container quantities as separate Capsule sources', (): void => {
    const quotas: KubeManifest[] = organizationGlobalCustomQuotaManifests({ organizationId: 'org_a' });
    const podQuotas: GlobalCustomQuotaSpec[] = quotas
      .map((manifest: KubeManifest): GlobalCustomQuotaSpec => manifest.spec as GlobalCustomQuotaSpec)
      .filter((spec: GlobalCustomQuotaSpec): boolean => spec.limit !== '20Gi');
    for (const quota of podQuotas) {
      expect(quota.sources).toHaveLength(2);
      expect(quota.sources[0]?.path).toContain('.spec.containers[*]');
      expect(quota.sources[1]?.path).toContain('.spec.initContainers[*]');
    }
  });

  it('projects an organization label onto the deterministic project namespace', (): void => {
    expect(projectNamespaceOrganizationLabelManifest('prj_01jz', 'org_01jz')).toEqual({
      apiVersion: 'v1',
      kind: 'Namespace',
      metadata: {
        labels: { 'compartment.dev/organization-id': 'org_01jz' },
        name: kubeNamespaceName('prj_01jz'),
      },
    });
  });
});
