import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { kubeResourceServiceDns } from '@compartment/utils';
import {
  assertResourceClaimIdentity,
  assertResourceClaimOwnership,
  kubeResourceVolumeName,
  projectResourceBootstrapClaims,
  projectResourceManifests,
  resourcePodsFullyTerminated,
  type KubeManifest,
  type ResourceProjectionRow,
} from '../src';

const row: ResourceProjectionRow = {
  containerPort: 5432,
  environmentId: 'env-01jz',
  env: { POSTGRES_PASSWORD: 'generated' },
  image: 'postgres@sha256:abc',
  namespaceId: 'prj-01jz',
  resourceId: 'res-01jz',
  secretId: 'sec-resource',
  volumes: [{ mountPath: '/var/lib/postgresql/data', size: '10Gi', volumeHandle: 'data' }],
};

describe('resource projection and fencing', (): void => {
  it('fails closed before mutation when expected identity, claim, binding, or UID is invalid', (): void => {
    const name: string = kubeResourceVolumeName(row.resourceId, 'data');
    expect((): void => assertResourceClaimIdentity([], [])).toThrow('Bootstrap is required');
    expect((): void => assertResourceClaimIdentity([{ claimName: name, uid: 'uid-1' }], [])).toThrow('is missing');
    expect((): void =>
      assertResourceClaimIdentity(
        [{ claimName: name, uid: 'uid-1' }],
        [{ bound: false, claimName: name, uid: 'uid-1' }],
      ),
    ).toThrow('missing or unbound');
    expect((): void =>
      assertResourceClaimIdentity(
        [{ claimName: name, uid: 'uid-1' }],
        [{ bound: true, claimName: name, uid: 'uid-2' }],
      ),
    ).toThrow('UID changed');
  });

  it('fences an unbound WaitForFirstConsumer claim by its created UID', (): void => {
    const name: string = kubeResourceVolumeName(row.resourceId, 'data');
    expect((): void =>
      assertResourceClaimOwnership(
        [{ claimName: name, uid: 'uid-1' }],
        [{ bound: false, claimName: name, uid: 'uid-1' }],
      ),
    ).not.toThrow();
    expect((): void =>
      assertResourceClaimOwnership(
        [{ claimName: name, uid: 'uid-1' }],
        [{ bound: false, claimName: name, uid: 'uid-2' }],
      ),
    ).toThrow('UID changed');
  });

  it('never includes a PVC in ordinary reconcile and isolates claims in explicit bootstrap', (): void => {
    expect(projectResourceManifests(row).map((manifest: KubeManifest): string => manifest.kind)).toEqual([
      'Secret',
      'Deployment',
      'Service',
    ]);
    expect(projectResourceBootstrapClaims(row)).toHaveLength(2);
    expect(projectResourceBootstrapClaims(row)[0]?.kind).toBe('PersistentVolumeClaim');
    expect(projectResourceBootstrapClaims(row)[1]?.metadata?.name).toBe(
      kubeResourceVolumeName(row.resourceId, 'backup-artifacts'),
    );
  });

  it('requires actual pod absence, including terminating pods', (): void => {
    expect(resourcePodsFullyTerminated([{ deletionTimestamp: '2026-07-12T00:00:00Z' }])).toBe(false);
    expect(resourcePodsFullyTerminated([])).toBe(true);
  });

  it('projects deterministic Recreate workload, PVC reference, Service DNS, and bootstrap golden', (): void => {
    expect(kubeResourceServiceDns(row.resourceId, row.namespaceId)).toMatch(/^resource-.+\.cpt-.+\.svc$/);
    const yaml: string = [...projectResourceManifests(row), ...projectResourceBootstrapClaims(row)]
      .map((manifest: KubeManifest): string => stringify(manifest, { sortMapEntries: true }).trim())
      .join('\n---\n')
      .replaceAll(/[a-f0-9]{64}/g, '<sha256>');
    expect(yaml).toMatchSnapshot();
    expect(yaml).toContain('type: Recreate');
    expect(yaml).toContain('replicas: 1');
  });

  it('matches the provisioned resource NetworkPolicy selector', (): void => {
    const manifests: KubeManifest[] = projectResourceManifests(row);
    const deployment: KubeManifest = manifests.find(
      (manifest: KubeManifest): boolean => manifest.kind === 'Deployment',
    )!;
    const service: KubeManifest = manifests.find((manifest: KubeManifest): boolean => manifest.kind === 'Service')!;

    expect(deployment.spec).toMatchObject({ selector: { matchLabels: { app: 'resource' } } });
    expect(service.spec).toMatchObject({ selector: { app: 'resource' } });
  });
});
