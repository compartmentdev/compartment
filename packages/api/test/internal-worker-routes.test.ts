import {
  buildWorkerUploadGitSourceResolutionTaskArchivePath,
  compartmentInternalAppAccessStatePathname,
  workerClaimNextDeploymentPathname,
  workerClaimProjectProvisioningPathname,
  workerClaimProjectProvisioningV2Pathname,
  workerCompleteProjectProvisioningPathname,
  workerCompleteProjectProvisioningV2Pathname,
  workerCompleteProjectProvisioningResponseSchema,
  workerRunNextScheduledResourceOperationPathname,
  workerRunNextScheduledResourceOperationResponseSchema,
  workerUploadGitSourceResolutionTaskArchiveResponseSchema,
} from '@compartment/contracts';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ApiApp } from '../src/app.types';
import type {
  claimQueuedDeploymentForWorker,
  recoverOrphanedDeploymentBuildClaims,
} from '../src/services/deployment-worker.service';
import type { storeSourceResolutionTaskArchive } from '../src/services/git-source/source-resolution-task-archive-storage.service';
import type { runNextScheduledResourceOperationForWorker } from '../src/services/resource-operation-scheduler.service';
import type {
  acknowledgeProjectProvisioning,
  acknowledgeProjectProvisioningV2,
  claimProjectProvisioning,
  claimProjectProvisioningV2,
} from '../src/services/project-provisioning.service';
import { applyApiRouteTestEnv, injectApiRoute, withApiRouteApp } from './api-route-test.harness';

type ClaimQueuedDeploymentForWorker = typeof claimQueuedDeploymentForWorker;
type RecoverOrphanedDeploymentBuildClaims = typeof recoverOrphanedDeploymentBuildClaims;
type RunNextScheduledResourceOperationForWorker = typeof runNextScheduledResourceOperationForWorker;
type StoreSourceResolutionTaskArchive = typeof storeSourceResolutionTaskArchive;
type ClaimProjectProvisioning = typeof claimProjectProvisioning;
type ClaimProjectProvisioningV2 = typeof claimProjectProvisioningV2;
type AcknowledgeProjectProvisioning = typeof acknowledgeProjectProvisioning;
type AcknowledgeProjectProvisioningV2 = typeof acknowledgeProjectProvisioningV2;

interface InternalWorkerRouteMocks {
  acknowledgeProjectProvisioning: Mock<AcknowledgeProjectProvisioning>;
  acknowledgeProjectProvisioningV2: Mock<AcknowledgeProjectProvisioningV2>;
  claimQueuedDeploymentForWorker: Mock<ClaimQueuedDeploymentForWorker>;
  recoverOrphanedDeploymentBuildClaims: Mock<RecoverOrphanedDeploymentBuildClaims>;
  claimProjectProvisioning: Mock<ClaimProjectProvisioning>;
  claimProjectProvisioningV2: Mock<ClaimProjectProvisioningV2>;
  runNextScheduledResourceOperationForWorker: Mock<RunNextScheduledResourceOperationForWorker>;
  storeSourceResolutionTaskArchive: Mock<StoreSourceResolutionTaskArchive>;
}

let previousSourceArchiveMaxBytes: string | undefined;
let shouldRestoreSourceArchiveMaxBytes: boolean = false;

const mocks: InternalWorkerRouteMocks = vi.hoisted(
  (): InternalWorkerRouteMocks => ({
    acknowledgeProjectProvisioning: vi.fn<AcknowledgeProjectProvisioning>(),
    acknowledgeProjectProvisioningV2: vi.fn<AcknowledgeProjectProvisioningV2>(),
    claimQueuedDeploymentForWorker: vi.fn<ClaimQueuedDeploymentForWorker>(),
    recoverOrphanedDeploymentBuildClaims: vi.fn<RecoverOrphanedDeploymentBuildClaims>(),
    claimProjectProvisioning: vi.fn<ClaimProjectProvisioning>(),
    claimProjectProvisioningV2: vi.fn<ClaimProjectProvisioningV2>(),
    runNextScheduledResourceOperationForWorker: vi.fn<RunNextScheduledResourceOperationForWorker>(),
    storeSourceResolutionTaskArchive: vi.fn<StoreSourceResolutionTaskArchive>(),
  }),
);

vi.mock(
  '../src/services/deployment-worker.service',
  (): {
    claimQueuedDeploymentForWorker: Mock<ClaimQueuedDeploymentForWorker>;
    recoverOrphanedDeploymentBuildClaims: Mock<RecoverOrphanedDeploymentBuildClaims>;
  } => ({
    claimQueuedDeploymentForWorker: mocks.claimQueuedDeploymentForWorker,
    recoverOrphanedDeploymentBuildClaims: mocks.recoverOrphanedDeploymentBuildClaims,
  }),
);

vi.mock(
  '../src/services/project-provisioning.service',
  (): {
    acknowledgeProjectProvisioning: Mock<AcknowledgeProjectProvisioning>;
    acknowledgeProjectProvisioningV2: Mock<AcknowledgeProjectProvisioningV2>;
    claimProjectProvisioning: Mock<ClaimProjectProvisioning>;
    claimProjectProvisioningV2: Mock<ClaimProjectProvisioningV2>;
  } => ({
    acknowledgeProjectProvisioning: mocks.acknowledgeProjectProvisioning,
    acknowledgeProjectProvisioningV2: mocks.acknowledgeProjectProvisioningV2,
    claimProjectProvisioning: mocks.claimProjectProvisioning,
    claimProjectProvisioningV2: mocks.claimProjectProvisioningV2,
  }),
);

vi.mock(
  '../src/services/git-source/source-resolution-task-archive-storage.service',
  (): {
    storeSourceResolutionTaskArchive: Mock<StoreSourceResolutionTaskArchive>;
  } => ({
    storeSourceResolutionTaskArchive: mocks.storeSourceResolutionTaskArchive,
  }),
);

vi.mock(
  '../src/services/resource-operation-scheduler.service',
  (): {
    runNextScheduledResourceOperationForWorker: Mock<RunNextScheduledResourceOperationForWorker>;
  } => ({
    runNextScheduledResourceOperationForWorker: mocks.runNextScheduledResourceOperationForWorker,
  }),
);

describe('internal worker routes', (): void => {
  afterEach((): void => {
    mocks.acknowledgeProjectProvisioning.mockReset();
    mocks.claimQueuedDeploymentForWorker.mockReset();
    mocks.recoverOrphanedDeploymentBuildClaims.mockReset();
    mocks.claimProjectProvisioning.mockReset();
    mocks.runNextScheduledResourceOperationForWorker.mockReset();
    mocks.storeSourceResolutionTaskArchive.mockReset();
    if (shouldRestoreSourceArchiveMaxBytes) {
      restoreOptionalEnvValue('COMPARTMENT_SOURCE_ARCHIVE_MAX_BYTES', previousSourceArchiveMaxBytes);
      shouldRestoreSourceArchiveMaxBytes = false;
    }
    previousSourceArchiveMaxBytes = undefined;
  });

  it('rejects runtime control auth on the edge-only app access state route', async (): Promise<void> => {
    applyApiRouteTestEnv();
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        headers: {
          accept: 'application/json',
          authorization: 'Bearer test-runtime-control-token',
        },
        method: 'GET',
        timeoutMs: 1000,
        url: compartmentInternalAppAccessStatePathname,
      });

      expect(response.statusCode).toBe(401);
      expect(mocks.claimQueuedDeploymentForWorker).not.toHaveBeenCalled();
    });
  });

  it('rejects edge auth on the worker-only claim-next route', async (): Promise<void> => {
    applyApiRouteTestEnv();
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        headers: {
          accept: 'application/json',
          authorization: 'Bearer test-edge-token',
        },
        method: 'POST',
        timeoutMs: 1000,
        url: workerClaimNextDeploymentPathname,
      });

      expect(response.statusCode).toBe(401);
      expect(mocks.claimQueuedDeploymentForWorker).not.toHaveBeenCalled();
    });
  });

  it('keeps project provisioning claims behind worker authentication', async (): Promise<void> => {
    applyApiRouteTestEnv();
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        headers: { accept: 'application/json', authorization: 'Bearer test-edge-token' },
        method: 'POST',
        timeoutMs: 1000,
        url: workerClaimProjectProvisioningV2Pathname,
      });

      expect(response.statusCode).toBe(401);
      expect(mocks.claimProjectProvisioningV2).not.toHaveBeenCalled();
    });
  });

  it('keeps the v1 provisioning routes compatible during a worker rollout', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.claimProjectProvisioning.mockResolvedValueOnce({
      leaseId: 'kpl_legacy',
      namespaceId: 'prj_legacy',
      projectId: 'prj_legacy',
    });
    mocks.acknowledgeProjectProvisioning.mockResolvedValueOnce(true);
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const headers: Record<string, string> = {
        accept: 'application/json',
        authorization: 'Bearer test-runtime-control-token',
        'content-type': 'application/json',
      };
      const claim: LightMyRequestResponse = await injectApiRoute(app, {
        headers,
        method: 'POST',
        timeoutMs: 1000,
        url: workerClaimProjectProvisioningPathname,
      });
      expect(claim.json()).toEqual({
        target: { leaseId: 'kpl_legacy', namespaceId: 'prj_legacy', projectId: 'prj_legacy' },
      });
      const completion: LightMyRequestResponse = await injectApiRoute(app, {
        headers,
        method: 'POST',
        payload: { leaseId: 'kpl_legacy', projectId: 'prj_legacy', status: 'succeeded' },
        timeoutMs: 1000,
        url: workerCompleteProjectProvisioningPathname,
      });
      expect(completion.statusCode).toBe(200);
      expect(mocks.acknowledgeProjectProvisioning).toHaveBeenCalledWith({
        leaseId: 'kpl_legacy',
        projectId: 'prj_legacy',
        status: 'succeeded',
      });
    });
  });

  it('completes project provisioning through the worker route contract', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.acknowledgeProjectProvisioningV2.mockResolvedValueOnce(true);
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        headers: {
          accept: 'application/json',
          authorization: 'Bearer test-runtime-control-token',
          'content-type': 'application/json',
        },
        method: 'POST',
        payload: {
          action: 'provision',
          leaseId: 'kpl_123',
          projectId: 'prj_123',
          status: 'succeeded',
        },
        timeoutMs: 1000,
        url: workerCompleteProjectProvisioningV2Pathname,
      });

      expect(response.statusCode).toBe(200);
      expect(workerCompleteProjectProvisioningResponseSchema.parse(response.json())).toEqual({ applied: true });
      expect(mocks.acknowledgeProjectProvisioningV2).toHaveBeenCalledWith({
        action: 'provision',
        leaseId: 'kpl_123',
        projectId: 'prj_123',
        status: 'succeeded',
      });
    });
  });

  it('returns the next scheduled resource operation response through the worker route contract', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.runNextScheduledResourceOperationForWorker.mockResolvedValueOnce({
      backupId: 'backup_123',
      cleanedBackups: [
        {
          backupId: 'backup_old',
          reason: 'retention-window',
        },
      ],
      operationType: 'backup',
      resourceName: 'postgres',
      ran: true,
    });

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        headers: {
          accept: 'application/json',
          authorization: 'Bearer test-runtime-control-token',
        },
        method: 'POST',
        timeoutMs: 1000,
        url: workerRunNextScheduledResourceOperationPathname,
      });

      expect(response.statusCode).toBe(200);
      expect(workerRunNextScheduledResourceOperationResponseSchema.parse(response.json())).toEqual({
        backupId: 'backup_123',
        cleanedBackups: [
          {
            backupId: 'backup_old',
            reason: 'retention-window',
          },
        ],
        operationType: 'backup',
        resourceName: 'postgres',
        ran: true,
      });
    });
  });

  it.each([
    '/internal/nodes/register',
    '/internal/deployments/runtime-state',
    '/internal/deployments/runtime-events',
    '/internal/deployments/recover-running?mode=invalid',
  ])('does not register removed runtime route %s', async (url: string): Promise<void> => {
    applyApiRouteTestEnv();
    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await injectApiRoute(app, {
        headers: {
          accept: 'application/json',
          authorization: 'Bearer test-runtime-control-token',
        },
        method: 'POST',
        timeoutMs: 1000,
        url,
      });

      expect(response.statusCode).toBe(404);
    });
  });

  it('accepts source resolution archives above the Fastify default body limit when within the configured limit', async (): Promise<void> => {
    prepareInternalWorkerRouteTestEnv(2 * 1024 * 1024);
    const sourceArchive: Buffer = Buffer.alloc(1_529_695, 1);
    mocks.storeSourceResolutionTaskArchive.mockResolvedValueOnce({
      byteSize: sourceArchive.byteLength,
      sourceDigest: 'digest',
    });

    await withApiRouteApp(async (app: ApiApp): Promise<void> => {
      const response: LightMyRequestResponse = await app.inject({
        headers: createWorkerArchiveHeaders(),
        method: 'POST',
        payload: sourceArchive,
        url: buildWorkerUploadGitSourceResolutionTaskArchivePath('srt_123'),
      });

      expect(response.statusCode).toBe(200);
      expect(workerUploadGitSourceResolutionTaskArchiveResponseSchema.parse(response.json())).toEqual({
        success: true,
      });
    });
  });
});

function prepareInternalWorkerRouteTestEnv(sourceArchiveMaxBytes: number): void {
  previousSourceArchiveMaxBytes = process.env.COMPARTMENT_SOURCE_ARCHIVE_MAX_BYTES;
  shouldRestoreSourceArchiveMaxBytes = true;
  applyApiRouteTestEnv();
  process.env.COMPARTMENT_SOURCE_ARCHIVE_MAX_BYTES = String(sourceArchiveMaxBytes);
}

function createWorkerArchiveHeaders(): Record<string, string> {
  return {
    accept: 'application/json',
    authorization: 'Bearer test-runtime-control-token',
    'content-type': 'application/gzip',
  };
}

function restoreOptionalEnvValue(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
