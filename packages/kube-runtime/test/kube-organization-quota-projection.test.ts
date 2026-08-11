import { describe, expect, it } from 'vitest';
import { organizationGlobalCustomQuotaManifests, type KubeManifest } from '../src';
import type { GlobalCustomQuotaSpec } from '../src/kube-organization-quota-projection.types';

describe('organization GlobalCustomQuota projection', (): void => {
  it('projects five deterministic quotas into one immutable organization namespace pool', (): void => {
    const input = { organizationId: 'org_01jz', reconciliationRequestedAt: '2026-08-11T10:00:00.000Z' };
    const first: KubeManifest[] = organizationGlobalCustomQuotaManifests(input);
    const second: KubeManifest[] = organizationGlobalCustomQuotaManifests(input);

    expect(second).toEqual(first);
    expect(first).toHaveLength(5);
    expect(first.map((manifest: KubeManifest): object | undefined => manifest.spec)).toMatchSnapshot();
    for (const manifest of first) {
      expect(manifest).toMatchObject({
        apiVersion: 'capsule.clastix.io/v1beta2',
        kind: 'GlobalCustomQuota',
        metadata: {
          annotations: { 'reconcile.projectcapsule.dev/requestedAt': input.reconciliationRequestedAt },
          labels: { 'compartment.dev/organization-id': 'org_01jz' },
        },
      });
    }
  });

  it('isolates object names and selectors between organizations', (): void => {
    const first: KubeManifest[] = organizationGlobalCustomQuotaManifests(quotaInput('org_a'));
    const second: KubeManifest[] = organizationGlobalCustomQuotaManifests(quotaInput('org_b'));
    expect(first.map((manifest: KubeManifest): string | undefined => manifest.metadata?.name)).not.toEqual(
      second.map((manifest: KubeManifest): string | undefined => manifest.metadata?.name),
    );
  });

  it('accounts for ordinary and init container quantities as separate Capsule sources', (): void => {
    const quotas: KubeManifest[] = organizationGlobalCustomQuotaManifests(quotaInput('org_a'));
    const podQuotas: GlobalCustomQuotaSpec[] = quotas
      .map((manifest: KubeManifest): GlobalCustomQuotaSpec => manifest.spec as GlobalCustomQuotaSpec)
      .filter((spec: GlobalCustomQuotaSpec): boolean => spec.sources[0]?.kind === 'Pod');
    for (const quota of podQuotas) {
      expect(quota.sources).toHaveLength(2);
      expect(quota.sources[0]?.path).toContain('.spec.containers[*]');
      expect(quota.sources[1]?.path).toContain('.spec.initContainers[*]');
    }
  });
});

function quotaInput(organizationId: string): { organizationId: string; reconciliationRequestedAt: string } {
  return { organizationId, reconciliationRequestedAt: '2026-08-11T10:00:00.000Z' };
}
