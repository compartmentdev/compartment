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
});

function applicationPodSpec(): KubeProjectedPodSpec {
  const deployment: KubeManifest = projectApplicationManifests(applicationRow()).find(
    (manifest: KubeManifest): boolean => manifest.kind === 'Deployment',
  )!;
  return (deployment as KubeDeploymentManifest).spec!.template.spec;
}

function resourcePodSpec(image?: string): KubeProjectedPodSpec {
  const deployment: KubeManifest = projectResourceManifests({
    ...resourceRow(),
    ...(image === undefined ? {} : { image }),
  }).find((manifest: KubeManifest): boolean => manifest.kind === 'Deployment')!;
  return (deployment as KubeDeploymentManifest).spec!.template.spec;
}

function releaseJobPodSpec(): KubeProjectedPodSpec {
  const spec: KubeJobSpec = {
    command: ['node'],
    env: {},
    id: 'release',
    image: 'node:24.15.0-bookworm',
    jobClass: 'release',
    labels: {},
    namespace: 'project',
    securityProfile: 'project-restricted',
    timeoutMs: 60_000,
  };
  const job: KubeJobManifest = kubeJobManifest(spec, 'release', {});
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
