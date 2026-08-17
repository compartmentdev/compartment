import { describe, expect, it } from 'vitest';
import { projectApplicationManifests, projectResourceManifests, projectResourceRollbackScheduling } from '../src';
import type { ApplicationProjectionRow } from '../src/kube-application-projection.types';
import { kubeJobManifest } from '../src/kube-job-projection';
import type { ResourceProjectionRow } from '../src/kube-resource-projection.types';
import type { KubeJobSpec, KubeManifest } from '../src/kube-runtime.types';
import type { KubeDataWorkloadScheduling, KubeWorkloadScheduling } from '../src/kube-workload-scheduling.types';
import { serializeManifestOnTheWire } from './kube-transport-audit.harness';
import type { WireObject } from './kube-transport-audit.test.types';

const infrastructureTimeoutMs: number = 600_000;
const tenantScheduling: KubeWorkloadScheduling = {
  nodeSelector: { 'compartment.dev/node-pool': 'tenant' },
  runtimeClassName: 'gvisor',
  tolerations: [{ effect: 'NoSchedule', key: 'compartment.dev/node-pool', operator: 'Equal', value: 'tenant' }],
};
const dataScheduling: KubeDataWorkloadScheduling = {
  nodeSelector: { 'compartment.dev/node-pool': 'data' },
  runtimeClassName: 'gvisor',
  tolerations: [{ effect: 'NoSchedule', key: 'compartment.dev/node-pool', operator: 'Equal', value: 'data' }],
};

describe('Kubernetes workload scheduling transport', (): void => {
  it('serializes PostgreSQL resources onto data workers while ordinary workloads stay on tenant workers', async (): Promise<void> => {
    const postgres: WireObject = await serializeManifestOnTheWire(
      deployment(projectResourceManifests(resourceRow('docker.io/library/postgres:16'), infrastructureTimeoutMs)),
    );
    const digestOnlyPostgres: WireObject = await serializeManifestOnTheWire(
      deployment(projectResourceManifests(resourceRow('postgres@sha256:abc'), infrastructureTimeoutMs)),
    );
    const genericResource: WireObject = await serializeManifestOnTheWire(
      deployment(projectResourceManifests(resourceRow('registry.example/acme/database:1'), infrastructureTimeoutMs)),
    );
    const application: WireObject = await serializeManifestOnTheWire(
      deployment(projectApplicationManifests(applicationRow(), infrastructureTimeoutMs)),
    );
    const release: WireObject = await serializeManifestOnTheWire(kubeJobManifest(jobSpec('release'), 'release', {}));
    const provisioning: WireObject = await serializeManifestOnTheWire(
      kubeJobManifest(jobSpec('operation'), 'provisioning', {
        'compartment.dev/job-class': 'project-provisioning',
      }),
    );

    expectScheduling(postgres, dataScheduling);
    expectScheduling(digestOnlyPostgres, dataScheduling);
    for (const workload of [genericResource, application, release, provisioning]) {
      expectScheduling(workload, tenantScheduling);
    }
  });

  it('recomputes rollback scheduling from the saved resource image', async (): Promise<void> => {
    const postgresRollback: WireObject = await serializeManifestOnTheWire(
      deployment(
        projectResourceRollbackScheduling(
          projectResourceManifests(resourceRow('postgres:16'), infrastructureTimeoutMs),
          resourceRow('registry.example/acme/database:2'),
        ),
      ),
    );
    const genericRollback: WireObject = await serializeManifestOnTheWire(
      deployment(
        projectResourceRollbackScheduling(
          projectResourceManifests(resourceRow('registry.example/acme/database:1'), infrastructureTimeoutMs),
          resourceRow('postgres:17'),
        ),
      ),
    );

    expectScheduling(postgresRollback, dataScheduling);
    expectScheduling(genericRollback, tenantScheduling);
  });
});

function deployment(manifests: KubeManifest[]): KubeManifest {
  const manifest: KubeManifest | undefined = manifests.find(
    (candidate: KubeManifest): boolean => candidate.kind === 'Deployment',
  );
  if (manifest === undefined) {
    throw new Error('Expected a Deployment manifest.');
  }
  return manifest;
}

function expectScheduling(serialized: WireObject, scheduling: KubeWorkloadScheduling): void {
  expect(serialized).toHaveProperty('spec.template.spec.nodeSelector', scheduling.nodeSelector);
  expect(serialized).toHaveProperty('spec.template.spec.priorityClassName', 'compartment-tenant');
  expect(serialized).toHaveProperty('spec.template.spec.runtimeClassName', scheduling.runtimeClassName);
  expect(serialized).toHaveProperty('spec.template.spec.tolerations', scheduling.tolerations);
}

function applicationRow(): ApplicationProjectionRow {
  return {
    containerPorts: [3000],
    deploymentId: 'deployment',
    environmentId: 'environment',
    environmentName: 'Production',
    env: {},
    image: 'registry.example/acme/application@sha256:abc',
    imagePullSecretId: 'pull-secret',
    namespaceId: 'project',
    organizationId: 'organization',
    organizationName: 'Organization',
    projectId: 'project',
    projectName: 'Project',
    readiness: null,
    replicas: 1,
    runCommand: null,
    scheduling: tenantScheduling,
    secretId: 'secret',
    serviceId: 'service',
    serviceName: 'Web',
    terminationGracePeriodSeconds: 45,
  };
}

function resourceRow(image: string): ResourceProjectionRow {
  return {
    command: [],
    dataScheduling,
    deleteData: false,
    environmentId: 'environment',
    env: {},
    image,
    namespaceId: 'project',
    operation: 'reconcile',
    ports: [],
    readiness: null,
    replicas: 1,
    resourceId: 'resource',
    scheduling: tenantScheduling,
    secretId: 'secret',
    volumes: [],
  };
}

function jobSpec(jobClass: 'operation' | 'release'): KubeJobSpec {
  return {
    command: ['node'],
    env: {},
    id: jobClass,
    image: 'node:24.15.0-bookworm',
    jobClass,
    labels: {},
    namespace: 'project',
    scheduling: tenantScheduling,
    securityProfile: jobClass === 'release' ? 'project-restricted' : 'restricted',
    timeoutMs: 60_000,
  };
}
