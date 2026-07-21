import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { projectTeardownPreparationHeartbeatIntervalMs } from '../src/queries/project-provisioning-policy';
import type { ProjectRow } from '../src/queries/projects.query.types';
import { cleanupPreparedProjectRuntime } from '../src/services/project-teardown-preparation.service';

type CleanupDeletedProjectRuntime = (project: ProjectRow) => Promise<void>;
type ReleaseProjectTeardownPreparation = (projectId: string, preparationLeaseId: string) => Promise<void>;
type RenewProjectTeardownPreparation = (projectId: string, preparationLeaseId: string) => Promise<boolean>;

const cleanupDeletedProjectRuntime: Mock<CleanupDeletedProjectRuntime> = vi.hoisted(
  (): Mock<CleanupDeletedProjectRuntime> => vi.fn(),
);
const releaseProjectTeardownPreparation: Mock<ReleaseProjectTeardownPreparation> = vi.hoisted(
  (): Mock<ReleaseProjectTeardownPreparation> => vi.fn(),
);
const renewProjectTeardownPreparation: Mock<RenewProjectTeardownPreparation> = vi.hoisted(
  (): Mock<RenewProjectTeardownPreparation> => vi.fn(),
);

vi.mock('../src/services/project-runtime-cleanup.service', (): object => ({ cleanupDeletedProjectRuntime }));
vi.mock('../src/queries/project-teardown.query', (): object => ({
  releaseProjectTeardownPreparation,
  renewProjectTeardownPreparation,
}));

describe('project teardown preparation', (): void => {
  beforeEach((): void => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    releaseProjectTeardownPreparation.mockResolvedValue(undefined);
  });

  afterEach((): void => {
    vi.useRealTimers();
  });

  it('retries a transient preparation heartbeat failure while cleanup remains active', async (): Promise<void> => {
    let finishCleanup: (() => void) | undefined;
    cleanupDeletedProjectRuntime.mockImplementation(
      async (): Promise<void> =>
        await new Promise<void>((resolve: () => void): void => {
          finishCleanup = resolve;
        }),
    );
    renewProjectTeardownPreparation.mockRejectedValueOnce(new Error('database unavailable')).mockResolvedValue(true);

    const cleanup: Promise<void> = cleanupPreparedProjectRuntime(project(), 'kpl_owner');
    await vi.advanceTimersByTimeAsync(projectTeardownPreparationHeartbeatIntervalMs);
    expect(renewProjectTeardownPreparation).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(projectTeardownPreparationHeartbeatIntervalMs);
    expect(renewProjectTeardownPreparation).toHaveBeenCalledTimes(2);

    finishCleanup?.();
    await expect(cleanup).resolves.toBeUndefined();
    expect(releaseProjectTeardownPreparation).not.toHaveBeenCalled();
  });
});

function project(): ProjectRow {
  return {
    archivedAt: new Date(),
    createdAt: new Date(),
    id: 'project',
    name: 'demo',
    organizationId: 'org',
    updatedAt: new Date(),
  };
}
