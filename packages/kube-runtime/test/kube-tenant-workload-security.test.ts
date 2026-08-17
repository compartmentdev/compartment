import { describe, expect, it } from 'vitest';
import { projectApplicationManifests, projectResourceManifests, type KubeManifest } from '../src';
import type { ApplicationProjectionRow } from '../src/kube-application-projection.types';
import { kubeJobManifest } from '../src/kube-job-projection';
import type {
  KubeDeploymentManifest,
  KubeJobManifest,
  KubeJobSpec,
  KubeProjectedPodSpec,
} from '../src/kube-runtime.types';
import type { ResourceProjectionRow } from '../src/kube-resource-projection.types';
import type { KubeDataWorkloadScheduling, KubeWorkloadScheduling } from '../src/kube-workload-scheduling.types';

interface TenantPodProjection {
  expectedRuntimeUserId: number;
  name: string;
  podSpec: KubeProjectedPodSpec;
}

describe('tenant workload restricted Pod Security', (): void => {
  it('projects complete restricted contexts for every tenant Pod type', (): void => {
    const workloads: TenantPodProjection[] = [
      { expectedRuntimeUserId: 10_001, name: 'application', podSpec: applicationPodSpec() },
      { expectedRuntimeUserId: 70, name: 'resource', podSpec: resourcePodSpec() },
      {
        expectedRuntimeUserId: 10_001,
        name: 'generic-resource',
        podSpec: resourcePodSpec('registry.example/acme/database:1'),
      },
      { expectedRuntimeUserId: 10_001, name: 'release-job', podSpec: releaseJobPodSpec() },
      { expectedRuntimeUserId: 999, name: 'resource-operation-job', podSpec: resourceOperationJobPodSpec() },
      {
        expectedRuntimeUserId: 10_001,
        name: 'generic-resource-operation-job',
        podSpec: resourceOperationJobPodSpec('registry.example/acme/maintenance:1'),
      },
    ];

    for (const workload of workloads) {
      expect(workload.podSpec.securityContext, workload.name).toMatchObject({
        runAsGroup: workload.expectedRuntimeUserId,
        runAsNonRoot: true,
        runAsUser: workload.expectedRuntimeUserId,
        seccompProfile: { type: 'RuntimeDefault' },
      });
      expect(workload.podSpec.securityContext?.runAsUser, workload.name).toBeGreaterThan(0);
      expect(workload.podSpec.securityContext?.runAsGroup, workload.name).toBeGreaterThan(0);
      for (const container of workload.podSpec.containers) {
        expect(container.securityContext, workload.name).toEqual({
          allowPrivilegeEscalation: false,
          capabilities: { drop: ['ALL'] },
          privileged: false,
        });
      }
    }
  });

  it('projects configured tenant scheduling for every tenant workload class', (): void => {
    for (const podSpec of [
      applicationPodSpec(tenantScheduling),
      resourcePodSpec('registry.example/acme/database:1', tenantScheduling),
      releaseJobPodSpec(tenantScheduling),
      provisioningJobPodSpec(tenantScheduling),
    ]) {
      expect(podSpec.nodeSelector).toEqual({ 'compartment.dev/node-pool': 'tenant' });
      expect(podSpec.priorityClassName).toBe('compartment-tenant');
      expect(podSpec.runtimeClassName).toBe('gvisor');
      expect(podSpec.tolerations).toEqual([
        { effect: 'NoSchedule', key: 'compartment.dev/node-pool', operator: 'Equal', value: 'tenant' },
      ]);
    }
  });

  it('projects data scheduling only for official PostgreSQL resources', (): void => {
    const postgresPodSpec: KubeProjectedPodSpec = resourcePodSpec(undefined, tenantScheduling, dataScheduling);
    const genericPodSpec: KubeProjectedPodSpec = resourcePodSpec(
      'registry.example/acme/database:1',
      tenantScheduling,
      dataScheduling,
    );

    expect(postgresPodSpec.nodeSelector).toEqual({ 'compartment.dev/node-pool': 'data' });
    expect(postgresPodSpec.tolerations).toEqual([
      { effect: 'NoSchedule', key: 'compartment.dev/node-pool', operator: 'Equal', value: 'data' },
    ]);
    expect(genericPodSpec.nodeSelector).toEqual({ 'compartment.dev/node-pool': 'tenant' });
    expect(genericPodSpec.tolerations).toEqual(tenantScheduling.tolerations);
  });

  it('uses the shared project group for resource-operation backup volumes', (): void => {
    const podSpec: KubeProjectedPodSpec = resourceOperationJobPodSpec();

    expect(podSpec.securityContext).toMatchObject({
      fsGroup: 10_001,
      fsGroupChangePolicy: 'Always',
      runAsGroup: 999,
      runAsUser: 999,
    });
  });

  it('omits tenant scheduling fields when tenant configuration is absent', (): void => {
    for (const podSpec of [
      applicationPodSpec(),
      resourcePodSpec('registry.example/acme/database:1'),
      releaseJobPodSpec(),
      provisioningJobPodSpec(),
    ]) {
      expect(podSpec).not.toHaveProperty('nodeSelector');
      expect(podSpec).not.toHaveProperty('priorityClassName');
      expect(podSpec).not.toHaveProperty('runtimeClassName');
      expect(podSpec).not.toHaveProperty('tolerations');
    }
  });
});

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

function applicationPodSpec(scheduling?: KubeWorkloadScheduling): KubeProjectedPodSpec {
  const deployment: KubeManifest = projectApplicationManifests(
    {
      ...applicationRow(),
      ...(scheduling === undefined ? {} : { scheduling }),
    },
    600_000,
  ).find((manifest: KubeManifest): boolean => manifest.kind === 'Deployment')!;
  return (deployment as KubeDeploymentManifest).spec!.template.spec;
}

function resourcePodSpec(
  image?: string,
  scheduling?: KubeWorkloadScheduling,
  resourceDataScheduling?: KubeDataWorkloadScheduling,
): KubeProjectedPodSpec {
  const deployment: KubeManifest = projectResourceManifests(
    {
      ...resourceRow(),
      ...(image === undefined ? {} : { image }),
      ...(scheduling === undefined ? {} : { scheduling }),
      ...(resourceDataScheduling === undefined ? {} : { dataScheduling: resourceDataScheduling }),
    },
    600_000,
  ).find((manifest: KubeManifest): boolean => manifest.kind === 'Deployment')!;
  return (deployment as KubeDeploymentManifest).spec!.template.spec;
}

function releaseJobPodSpec(scheduling?: KubeWorkloadScheduling): KubeProjectedPodSpec {
  const spec: KubeJobSpec = {
    command: ['node'],
    env: {},
    id: 'release',
    image: 'node:24.15.0-bookworm',
    jobClass: 'release',
    labels: {},
    namespace: 'project',
    securityProfile: 'project-restricted',
    ...(scheduling === undefined ? {} : { scheduling }),
    timeoutMs: 60_000,
  };
  const job: KubeJobManifest = kubeJobManifest(spec, 'release', {});
  return job.spec!.template.spec;
}

function provisioningJobPodSpec(scheduling?: KubeWorkloadScheduling): KubeProjectedPodSpec {
  const spec: KubeJobSpec = {
    command: ['node'],
    env: {},
    id: 'provisioning',
    image: 'node:24.15.0-bookworm',
    jobClass: 'operation',
    labels: { 'compartment.dev/job-class': 'project-provisioning' },
    namespace: 'provisioning',
    securityProfile: 'restricted',
    ...(scheduling === undefined ? {} : { scheduling }),
    timeoutMs: 60_000,
  };
  const job: KubeJobManifest = kubeJobManifest(spec, 'provisioning', {});
  return job.spec!.template.spec;
}

function resourceOperationJobPodSpec(image: string = 'docker.io/library/postgres:16'): KubeProjectedPodSpec {
  const spec: KubeJobSpec = {
    command: ['postgres'],
    env: {},
    id: 'resource-operation',
    image,
    jobClass: 'operation',
    labels: {},
    namespace: 'project',
    securityProfile: 'resource-restricted',
    timeoutMs: 60_000,
    volumeMounts: [
      {
        claimName: 'volume-resource-backup-artifacts',
        expectedClaimUid: 'uid-backup-artifacts',
        mountPath: '/backups',
        name: 'backup-artifacts',
        resourceId: 'resource',
      },
    ],
  };
  const job: KubeJobManifest = kubeJobManifest(spec, 'resource-operation', {});
  return job.spec!.template.spec;
}

function applicationRow(): ApplicationProjectionRow {
  return {
    containerPorts: [3000],
    deploymentId: 'deployment',
    environmentId: 'environment',
    environmentName: 'Production',
    env: {},
    image: 'node:24.15.0-bookworm',
    imagePullSecretId: 'pull-secret',
    namespaceId: 'project',
    organizationId: 'organization',
    organizationName: 'Organization',
    projectId: 'project',
    projectName: 'Project',
    readiness: null,
    replicas: 1,
    runCommand: null,
    secretId: 'secret',
    serviceId: 'service',
    serviceName: 'Web',
    terminationGracePeriodSeconds: 45,
  };
}

function resourceRow(): ResourceProjectionRow {
  return {
    command: [],
    dataScheduling,
    deleteData: false,
    environmentId: 'environment',
    env: {},
    image: 'docker.io/library/postgres:16-alpine3.22@sha256:generated',
    namespaceId: 'project',
    operation: 'reconcile',
    ports: [],
    readiness: null,
    replicas: 1,
    resourceId: 'resource',
    secretId: 'secret',
    volumes: [{ mountPath: '/data', size: '1Gi', volumeHandle: 'data' }],
  };
}
