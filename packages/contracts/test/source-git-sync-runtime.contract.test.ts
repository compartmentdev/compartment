import { describe, expect, it } from 'vitest';
import {
  workerClaimGitSourceSyncTaskResponseSchema,
  workerCompleteGitSourceSyncTaskRequestSchema,
  workerFailGitSourceSyncTaskRequestSchema,
  type WorkerClaimGitSourceSyncTaskResponse,
  type WorkerCompleteGitSourceSyncTaskRequest,
  type WorkerFailGitSourceSyncTaskRequest,
} from '../src';
import { expectSchemaRejects } from './schema-test.helpers';

describe('source git sync runtime contract', (): void => {
  it('requires the source sync claim token on worker claim, complete, and fail payloads', (): void => {
    const claim: WorkerClaimGitSourceSyncTaskResponse = workerClaimGitSourceSyncTaskResponseSchema.parse({
      task: {
        claimToken: 'wrk_claim',
        installationToken: 'installation-token',
        providerHost: 'github.com',
        repositoryName: 'mono',
        repositoryOwner: 'acme',
        requestedBranchName: 'main',
        sourceId: 'src_123',
        taskId: 'sst_123',
        triggerCommitSha: null,
      },
    });
    const complete: WorkerCompleteGitSourceSyncTaskRequest = workerCompleteGitSourceSyncTaskRequestSchema.parse({
      candidates: [],
      claimToken: 'wrk_claim',
      resolvedCommitSha: 'sha_sync',
      taskId: 'sst_123',
    });
    const fail: WorkerFailGitSourceSyncTaskRequest = workerFailGitSourceSyncTaskRequestSchema.parse({
      claimToken: 'wrk_claim',
      failureReason: 'checkout failed',
      taskId: 'sst_123',
    });

    expect(claim.task?.claimToken).toBe('wrk_claim');
    expect(complete.claimToken).toBe('wrk_claim');
    expect(fail.claimToken).toBe('wrk_claim');
    expect((): void => {
      workerCompleteGitSourceSyncTaskRequestSchema.parse({
        candidates: [],
        resolvedCommitSha: 'sha_sync',
        taskId: 'sst_123',
      });
    }).toThrow();
  });

  it('rejects non-canonical source sync candidate project names', (): void => {
    expectSchemaRejects(workerCompleteGitSourceSyncTaskRequestSchema, {
      candidates: [
        {
          blockedReason: null,
          derivedWatchPaths: [],
          descriptorDirectory: 'apps/billing',
          descriptorPath: 'apps/billing/compartment.yml',
          projectName: 'Billing_App',
        },
      ],
      claimToken: 'wrk_claim',
      resolvedCommitSha: 'sha_sync',
      taskId: 'sst_123',
    });
  });
});
