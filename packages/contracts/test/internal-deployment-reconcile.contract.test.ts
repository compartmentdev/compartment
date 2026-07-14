import { describe, expect, it } from 'vitest';
import {
  workerClaimDeploymentReconcileResponseSchema,
  workerObserveDeploymentReconcileRequestSchema,
  type DeploymentReconcileProjection,
  type WorkerObserveDeploymentReconcileRequest,
} from '../src';

describe('deployment reconcile contracts', (): void => {
  it('accepts candidate and saved active projections without rollout DTO state', (): void => {
    const projection: DeploymentReconcileProjection = {
      containerPort: 3000,
      deploymentId: 'dep_candidate',
      environmentId: 'env_1',
      environmentName: 'production',
      env: { PORT: '3000' },
      image: 'registry/app@sha256:abc',
      imagePullSecretId: 'prj_1',
      namespaceId: 'prj_1',
      organizationId: 'org_1',
      organizationName: 'Acme',
      projectId: 'prj_1',
      projectName: 'app',
      readiness: { path: '/healthz', timeoutMs: 60_000, type: 'http' },
      releaseCommand: null,
      replicas: 1,
      runCommand: null,
      secretId: 'dep_candidate',
      serviceId: 'svc_1',
      serviceName: 'web',
      terminationGracePeriodSeconds: 45,
    };
    expect(
      workerClaimDeploymentReconcileResponseSchema.safeParse({
        target: {
          active: { ...projection, deploymentId: 'dep_active', image: 'registry/app@sha256:old' },
          candidate: projection,
          revision: 2,
          rolloutStartedAt: '2026-07-12T10:00:00.000Z',
          state: 'pending',
        },
      }).success,
    ).toBe(true);
  });

  it('requires a failure message and revision', (): void => {
    const request: Omit<WorkerObserveDeploymentReconcileRequest, 'message'> = {
      deploymentId: 'dep_1',
      observation: 'failed',
      observedAt: '2026-07-12T10:00:00.000Z',
      revision: 1,
    };
    expect(workerObserveDeploymentReconcileRequestSchema.safeParse(request).success).toBe(false);
    expect(
      workerObserveDeploymentReconcileRequestSchema.safeParse({ ...request, message: 'rollout failed' }).success,
    ).toBe(true);
  });

  it('accepts the internal stop claim and acknowledgement', (): void => {
    expect(
      workerObserveDeploymentReconcileRequestSchema.safeParse({
        deploymentId: 'dep_1',
        observation: 'stopped',
        observedAt: '2026-07-12T10:00:00.000Z',
        revision: 3,
      }).success,
    ).toBe(true);
  });
});
