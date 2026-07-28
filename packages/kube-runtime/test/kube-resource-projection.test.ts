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
  type KubeDeploymentManifest,
  type KubeManifest,
  type ResourceProjectionRow,
} from '../src';
import { kubeNamespaceName } from '../src/kube-naming';
import type { KubeProjectedContainer } from '../src/kube-runtime.types';
import { secretChecksum } from '../src/kube-secret-projection';

const row: ResourceProjectionRow = {
  command: ['postgres', '-c', 'shared_buffers=256MB'],
  deleteData: false,
  environmentId: 'env-01jz',
  env: { POSTGRES_PASSWORD: 'generated' },
  image: 'docker.io/library/postgres:16-alpine@sha256:abc',
  namespaceId: 'prj-01jz',
  operation: 'reconcile',
  ports: [5432, 9187],
  readiness: { port: 5432, timeoutMs: 30_000, type: 'tcp' },
  replicas: 1,
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
        [{ bound: false, claimName: name, resourceVersion: '1', uid: 'uid-1' }],
      ),
    ).toThrow('missing or unbound');
    expect((): void =>
      assertResourceClaimIdentity(
        [{ claimName: name, uid: 'uid-1' }],
        [{ bound: true, claimName: name, resourceVersion: '2', uid: 'uid-2' }],
      ),
    ).toThrow('UID changed');
  });

  it('fences an unbound WaitForFirstConsumer claim by its created UID', (): void => {
    const name: string = kubeResourceVolumeName(row.resourceId, 'data');
    expect((): void =>
      assertResourceClaimOwnership(
        [{ claimName: name, uid: 'uid-1' }],
        [{ bound: false, claimName: name, resourceVersion: '1', uid: 'uid-1' }],
      ),
    ).not.toThrow();
    expect((): void =>
      assertResourceClaimOwnership(
        [{ claimName: name, uid: 'uid-1' }],
        [{ bound: false, claimName: name, resourceVersion: '2', uid: 'uid-2' }],
      ),
    ).toThrow('UID changed');
  });

  it('never includes a PVC in ordinary reconcile and isolates claims in explicit bootstrap', (): void => {
    expect(projectResourceManifests(row).map((manifest: KubeManifest): string => manifest.kind)).toEqual([
      'Secret',
      'Deployment',
      'Service',
    ]);
    expect(projectResourceManifests(row)[0]?.metadata?.labels?.['compartment.dev/resource-id']).toBe(row.resourceId);
    expect(projectResourceBootstrapClaims(row)).toHaveLength(2);
    expect(projectResourceBootstrapClaims(row)[0]?.kind).toBe('PersistentVolumeClaim');
    expect(projectResourceBootstrapClaims(row)[1]?.metadata?.name).toBe(
      kubeResourceVolumeName(row.resourceId, 'backup-artifacts'),
    );
  });

  it('pins resource Pods to the project identity and the restricted security profile', (): void => {
    const deployment: KubeManifest = projectResourceManifests(row).find(
      (manifest: KubeManifest): boolean => manifest.kind === 'Deployment',
    )!;

    expect(deployment.spec).toMatchObject({
      template: {
        spec: {
          automountServiceAccountToken: false,
          containers: [
            {
              securityContext: {
                allowPrivilegeEscalation: false,
                capabilities: { drop: ['ALL'] },
                privileged: false,
              },
            },
          ],
          securityContext: {
            fsGroup: 70,
            fsGroupChangePolicy: 'Always',
            runAsGroup: 70,
            runAsNonRoot: true,
            runAsUser: 70,
            seccompProfile: { type: 'RuntimeDefault' },
          },
          serviceAccountName: kubeNamespaceName(row.namespaceId),
        },
      },
    });
    for (const forbiddenField of ['hostIPC', 'hostNetwork', 'hostPID', 'hostPath', 'runtimeClassName']) {
      expect(deployment.spec).not.toHaveProperty(`template.spec.${forbiddenField}`);
    }
    expect(deployment.spec).not.toHaveProperty('template.spec.volumes.0.hostPath');
  });

  it('assigns a numeric non-root runtime identity to generic resources', (): void => {
    const deployment: KubeManifest = projectResourceManifests({
      ...row,
      image: 'registry.example/acme/postgres:16-alpine',
    }).find((manifest: KubeManifest): boolean => manifest.kind === 'Deployment')!;

    expect(deployment.spec).toHaveProperty('template.spec.securityContext.fsGroup', 10_001);
    expect(deployment.spec).toHaveProperty('template.spec.securityContext.runAsUser', 10_001);
    expect(deployment.spec).toHaveProperty('template.spec.securityContext.runAsGroup', 10_001);
    expect(deployment.spec).toHaveProperty('template.spec.securityContext.runAsNonRoot', true);
    expect(deployment.spec).not.toHaveProperty('template.spec.containers.0.command');
  });

  it('preserves the official Debian PostgreSQL runtime identity', (): void => {
    const deployment: KubeManifest = projectResourceManifests({
      ...row,
      image: 'docker.io/library/postgres:16@sha256:def',
    }).find((manifest: KubeManifest): boolean => manifest.kind === 'Deployment')!;

    expect(deployment.spec).toHaveProperty('template.spec.securityContext.fsGroup', 999);
    expect(deployment.spec).toHaveProperty('template.spec.securityContext.runAsUser', 999);
    expect(deployment.spec).toHaveProperty('template.spec.securityContext.runAsGroup', 999);
  });

  it('assigns the generic identity to variant-ambiguous PostgreSQL digests', (): void => {
    const deployment: KubeManifest = projectResourceManifests({
      ...row,
      image: 'postgres@sha256:def',
    }).find((manifest: KubeManifest): boolean => manifest.kind === 'Deployment')!;

    expect(deployment.spec).toHaveProperty('template.spec.securityContext.fsGroup', 10_001);
    expect(deployment.spec).toHaveProperty('template.spec.securityContext.runAsUser', 10_001);
    expect(deployment.spec).not.toHaveProperty('template.spec.containers.0.command');
  });

  it('recognizes the official PostgreSQL Alpine shorthand identity', (): void => {
    const deployment: KubeManifest = projectResourceManifests({
      ...row,
      image: 'postgres:alpine3.22',
    }).find((manifest: KubeManifest): boolean => manifest.kind === 'Deployment')!;

    expect(deployment.spec).toHaveProperty('template.spec.securityContext.fsGroup', 70);
    expect(deployment.spec).toHaveProperty('template.spec.securityContext.runAsUser', 70);
    expect(deployment.spec).toHaveProperty('template.spec.securityContext.runAsGroup', 70);
  });

  it('selects an upgrade-safe writable PostgreSQL data directory at startup', (): void => {
    const manifests: KubeManifest[] = projectResourceManifests(row);
    const secret: KubeManifest = manifests.find((manifest: KubeManifest): boolean => manifest.kind === 'Secret')!;
    const deployment: KubeManifest = manifests.find(
      (manifest: KubeManifest): boolean => manifest.kind === 'Deployment',
    )!;

    expect(secret.stringData).not.toHaveProperty('PGDATA');
    expect((deployment as KubeDeploymentManifest).spec!.template.spec.containers[0]).toMatchObject({
      args: [
        expect.stringContaining('[ -f /var/lib/postgresql/data/PG_VERSION ]'),
        'compartment-postgres',
        ...row.command,
      ],
      command: ['/bin/sh', '-c'],
    });
  });

  it('preserves an explicit PostgreSQL data directory and its rollout checksum', (): void => {
    const env: Readonly<Record<string, string>> = {
      ...row.env,
      PGDATA: '/var/lib/postgresql/data/custom',
    };
    const manifests: KubeManifest[] = projectResourceManifests({ ...row, env });
    const secret: KubeManifest = manifests.find((manifest: KubeManifest): boolean => manifest.kind === 'Secret')!;
    const deployment: KubeDeploymentManifest = manifests.find(
      (manifest: KubeManifest): boolean => manifest.kind === 'Deployment',
    ) as KubeDeploymentManifest;
    const container: KubeProjectedContainer = deployment.spec!.template.spec.containers[0]!;

    expect(secret.stringData).toHaveProperty('PGDATA', env.PGDATA);
    expect(deployment.spec!.template.metadata.annotations).toHaveProperty(
      'compartment.dev/secret-checksum',
      secretChecksum(env),
    );
    expect(container).not.toHaveProperty('command');
    expect(container.args).toEqual(row.command);
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
    expect(yaml).toContain('type: Recreate');
    expect(yaml).toContain('replicas: 1');
  });

  it('projects the complete command, port, and readiness intent', (): void => {
    const manifests: KubeManifest[] = projectResourceManifests(row);
    const deployment: KubeManifest = manifests.find(
      (manifest: KubeManifest): boolean => manifest.kind === 'Deployment',
    )!;
    const service: KubeManifest = manifests.find((manifest: KubeManifest): boolean => manifest.kind === 'Service')!;

    expect(deployment.spec).toMatchObject({
      progressDeadlineSeconds: 30,
      template: {
        spec: {
          containers: [
            {
              ports: [
                { containerPort: 5432, name: 'tcp-5432', protocol: 'TCP' },
                { containerPort: 9187, name: 'tcp-9187', protocol: 'TCP' },
              ],
              readinessProbe: { tcpSocket: { port: 5432 } },
            },
          ],
        },
      },
    });
    expect(
      (deployment as KubeDeploymentManifest).spec!.template.spec.containers[0]!.args?.slice(-row.command.length),
    ).toEqual(row.command);
    expect(service.spec).toMatchObject({
      clusterIP: 'None',
      ports: [
        { name: 'tcp-5432', port: 5432, protocol: 'TCP', targetPort: 5432 },
        { name: 'tcp-9187', port: 9187, protocol: 'TCP', targetPort: 9187 },
      ],
    });
  });

  it('keeps stable DNS without inventing ports or a readiness probe for a background resource', (): void => {
    const manifests: KubeManifest[] = projectResourceManifests({ ...row, command: [], ports: [], readiness: null });
    const deployment: KubeManifest = manifests.find(
      (manifest: KubeManifest): boolean => manifest.kind === 'Deployment',
    )!;

    const service: KubeManifest = manifests.find((manifest: KubeManifest): boolean => manifest.kind === 'Service')!;
    expect(service.spec).toMatchObject({ clusterIP: 'None', ports: [] });
    expect(deployment.spec).toMatchObject({
      template: { spec: { containers: [{ image: row.image, name: 'resource' }] } },
    });
    expect(deployment.spec).not.toHaveProperty('template.spec.containers.0.readinessProbe');
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
