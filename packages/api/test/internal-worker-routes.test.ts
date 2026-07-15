import {
  buildWorkerUploadGitSourceResolutionTaskArchivePath,
  compartmentInternalAppAccessStatePathname,
  errorResponseSchema,
  workerClaimNextDeploymentPathname,
  workerClaimProjectProvisioningPathname,
  workerCompleteProjectProvisioningPathname,
  workerCompleteProjectProvisioningResponseSchema,
  workerRecoverDeploymentsPathname,
  workerRunNextScheduledResourceOperationPathname,
  workerRunNextScheduledResourceOperationResponseSchema,
  workerUploadGitSourceResolutionTaskArchiveResponseSchema,
} from '@compartment/contracts';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ApiApp } from '../src/app.types';
import type {
  claimQueuedDeploymentForWorker,
  recoverOrphanedRunningDeploymentsForWorker,
} from '../src/services/deployment-worker.service';
import type { storeSourceResolutionTaskArchive } from '../src/services/git-source/source-resolution-task-archive-storage.service';
import type { runNextScheduledResourceOperationForWorker } from '../src/services/resource-operation-scheduler.service';
import type {
  acknowledgeProjectProvisioning,
  claimProjectProvisioning,
} from '../src/services/project-provisioning.service';
import { applyApiRouteTestEnv, injectApiRoute, withApiRouteApp } from './api-route-test.harness';

type ClaimQueuedDeploymentForWorker = typeof claimQueuedDeploymentForWorker;
type RecoverOrphanedRunningDeploymentsForWorker = typeof recoverOrphanedRunningDeploymentsForWorker;
type RunNextScheduledResourceOperationForWorker = typeof runNextScheduledResourceOperationForWorker;
type StoreSourceResolutionTaskArchive = typeof storeSourceResolutionTaskArchive;
type ClaimProjectProvisioning = typeof claimProjectProvisioning;
type AcknowledgeProjectProvisioning = typeof acknowledgeProjectProvisioning;

interface InternalWorkerRouteMocks {
  acknowledgeProjectProvisioning: Mock<AcknowledgeProjectProvisioning>;
  claimQueuedDeploymentForWorker: Mock<ClaimQueuedDeploymentForWorker>;
  claimProjectProvisioning: Mock<ClaimProjectProvisioning>;
  recoverOrphanedRunningDeploymentsForWorker: Mock<RecoverOrphanedRunningDeploymentsForWorker>;
  runNextScheduledResourceOperationForWorker: Mock<RunNextScheduledResourceOperationForWorker>;
  storeSourceResolutionTaskArchive: Mock<StoreSourceResolutionTaskArchive>;
}

interface TestErrorDetails {
  code: string;
  message: string;
}

interface TestErrorResponse {
  error: TestErrorDetails;
}

let previousSourceArchiveMaxBytes: string | undefined;
let shouldRestoreSourceArchiveMaxBytes: boolean = false;

const mocks: InternalWorkerRouteMocks = vi.hoisted(
  (): InternalWorkerRouteMocks => ({
    acknowledgeProjectProvisioning: vi.fn<AcknowledgeProjectProvisioning>(),
    claimQueuedDeploymentForWorker: vi.fn<ClaimQueuedDeploymentForWorker>(),
    claimProjectProvisioning: vi.fn<ClaimProjectProvisioning>(),
    recoverOrphanedRunningDeploymentsForWorker: vi.fn<RecoverOrphanedRunningDeploymentsForWorker>(),
    runNextScheduledResourceOperationForWorker: vi.fn<RunNextScheduledResourceOperationForWorker>(),
    storeSourceResolutionTaskArchive: vi.fn<StoreSourceResolutionTaskArchive>(),
  }),
);

vi.mock(
  '../src/services/deployment-worker.service',
  (): {
    claimQueuedDeploymentForWorker: Mock<ClaimQueuedDeploymentForWorker>;
    recoverOrphanedRunningDeploymentsForWorker: Mock<RecoverOrphanedRunningDeploymentsForWorker>;
  } => ({
    claimQueuedDeploymentForWorker: mocks.claimQueuedDeploymentForWorker,
    recoverOrphanedRunningDeploymentsForWorker: mocks.recoverOrphanedRunningDeploymentsForWorker,
  }),
);

vi.mock(
  '../src/services/project-provisioning.service',
  (): {
    acknowledgeProjectProvisioning: Mock<AcknowledgeProjectProvisioning>;
    claimProjectProvisioning: Mock<ClaimProjectProvisioning>;
  } => ({
    acknowledgeProjectProvisioning: mocks.acknowledgeProjectProvisioning,
    claimProjectProvisioning: mocks.claimProjectProvisioning,
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
    mocks.claimProjectProvisioning.mockReset();
    mocks.recoverOrphanedRunningDeploymentsForWorker.mockReset();
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
        url: workerClaimProjectProvisioningPathname,
      });

      expect(response.statusCode).toBe(401);
      expect(mocks.claimProjectProvisioning).not.toHaveBeenCalled();
    });
  });

  it('completes project provisioning through the worker route contract', async (): Promise<void> => {
    applyApiRouteTestEnv();
    mocks.acknowledgeProjectProvisioning.mockResolvedValueOnce(true);
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
          cleanupRequired: false,
          leaseId: 'kpl_123',
          projectId: 'prj_123',
          status: 'succeeded',
        },
        timeoutMs: 1000,
        url: workerCompleteProjectProvisioningPathname,
      });

      expect(response.statusCode).toBe(200);
      expect(workerCompleteProjectProvisioningResponseSchema.parse(response.json())).toEqual({ applied: true });
      expect(mocks.acknowledgeProjectProvisioning).toHaveBeenCalledWith({
        action: 'provision',
        cleanupRequired: false,
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
    [`${workerRecoverDeploymentsPathname}?mode=invalid`],
    [`${workerRecoverDeploymentsPathname}?mode=all&unexpected=1`],
  ])('rejects invalid recovery query params through the worker route contract', async (url: string): Promise<void> => {
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

      expect(response.statusCode).toBe(400);
      const payload: TestErrorResponse = errorResponseSchema.parse(response.json());
      expect(payload.error).toEqual({
        code: 'invalid_worker_recover_deployments_query',
        message: 'The worker recovery query is invalid.',
      });
      expect(mocks.recoverOrphanedRunningDeploymentsForWorker).not.toHaveBeenCalled();
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
