import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ResourceTransaction } from '../src/queries/resources.query.types';
import { createResourceBackupForPrincipal } from '../src/services/resource-backups.service';
import type { ResourceActionInput, ResourceBackupResult } from '../src/services/resources.service.types';

type TestTransactionCallback = (tx: ResourceTransaction) => Promise<ResourceBackupResult>;
type TestTransaction = (run: TestTransactionCallback) => Promise<ResourceBackupResult>;

const lockReconciliation: Mock = vi.hoisted((): Mock => vi.fn());
const lockResource: Mock = vi.hoisted((): Mock => vi.fn());
const resolveContext: Mock = vi.hoisted((): Mock => vi.fn());
const runBackup: Mock = vi.hoisted((): Mock => vi.fn());
const transaction: Mock<TestTransaction> = vi.hoisted((): Mock<TestTransaction> => vi.fn());
const withResourceOperationLocks: Mock = vi.hoisted((): Mock => vi.fn());

vi.mock('../src/queries/resources.query', (): object => ({
  findProjectResourceByName: vi.fn(),
  lockProjectResourceOperation: lockReconciliation,
  lockProjectResourceReferenceByName: lockResource,
}));
vi.mock('../src/services/resource-environment-context.service', (): object => ({
  resolveResourceEnvironmentContext: resolveContext,
}));
vi.mock('../src/services/resource-backups.execution.service', (): object => ({
  assertResourceDefinesOperation: vi.fn(),
  runResourceBackup: runBackup,
  runResourceRestore: vi.fn(),
}));
vi.mock('../src/runtime/runtime-access', (): object => ({
  getApiDatabase: (): object => ({ transaction }),
}));
vi.mock('../src/services/resource-operation-lock.service', (): object => ({
  withResourceOperationLocks,
}));

describe('resource backup archive boundary', (): void => {
  beforeEach((): void => {
    vi.clearAllMocks();
    resolveContext.mockResolvedValue({
      environment: { id: 'env_prod' },
      organization: { id: 'org' },
      project: { id: 'prj' },
    });
    transaction.mockImplementation(
      async (run: TestTransactionCallback): Promise<ResourceBackupResult> => await run({} as ResourceTransaction),
    );
    lockResource.mockResolvedValue({ id: 'res_postgres', name: 'postgres' });
    let previous: Promise<void> = Promise.resolve();
    withResourceOperationLocks.mockImplementation(
      async (_resourceIds: string[], operation: TestTransactionCallback): Promise<ResourceBackupResult> => {
        const waitForPrevious: Promise<void> = previous;
        let releaseCurrent: (() => void) | undefined;
        previous = new Promise<void>((resolve: () => void): void => {
          releaseCurrent = resolve;
        });
        await waitForPrevious;
        try {
          return await operation({} as ResourceTransaction);
        } finally {
          releaseCurrent?.();
        }
      },
    );
  });

  it('refuses to start a backup when the project is archived after context resolution', async (): Promise<void> => {
    lockReconciliation.mockResolvedValue(new Date('2026-07-15T12:00:00.000Z'));

    await expect(
      createResourceBackupForPrincipal({
        actorPrincipalId: 'prn_admin',
        organizationSlug: 'organization',
        query: { projectName: 'project', resourceName: 'postgres' },
      }),
    ).rejects.toMatchObject({ code: 'project_archived' });

    expect(runBackup).not.toHaveBeenCalled();
  });

  it('commits the archive fence before starting the long-running backup Job', async (): Promise<void> => {
    let transactionOpen: boolean = false;
    transaction.mockImplementation(async (run: TestTransactionCallback): Promise<ResourceBackupResult> => {
      transactionOpen = true;
      const result: ResourceBackupResult = await run({} as ResourceTransaction);
      transactionOpen = false;
      return result;
    });
    lockReconciliation.mockResolvedValue(null);
    runBackup.mockImplementation(async (): Promise<ResourceBackupResult> => {
      expect(transactionOpen).toBe(false);
      return await Promise.resolve({} as ResourceBackupResult);
    });

    await createResourceBackupForPrincipal({
      actorPrincipalId: 'prn_admin',
      organizationSlug: 'organization',
      query: { projectName: 'project', resourceName: 'postgres' },
    });

    expect(runBackup).toHaveBeenCalledOnce();
  });

  it('refuses to enqueue resource-operation work after deletion has started', async (): Promise<void> => {
    lockReconciliation.mockResolvedValue(null);
    lockResource.mockResolvedValue({ id: 'res_postgres', name: 'postgres', status: 'deleting' });

    await expect(
      createResourceBackupForPrincipal({
        actorPrincipalId: 'prn_admin',
        organizationSlug: 'organization',
        query: { projectName: 'project', resourceName: 'postgres' },
      }),
    ).rejects.toMatchObject({ code: 'resource_not_found' });

    expect(runBackup).not.toHaveBeenCalled();
  });

  it('serializes complete backup workflows for the same resource', async (): Promise<void> => {
    let finishFirstBackup: (() => void) | undefined;
    runBackup
      .mockImplementationOnce(
        async (): Promise<ResourceBackupResult> =>
          await new Promise<ResourceBackupResult>((resolve: (value: ResourceBackupResult) => void): void => {
            finishFirstBackup = (): void => resolve({} as ResourceBackupResult);
          }),
      )
      .mockResolvedValueOnce({});
    lockReconciliation.mockResolvedValue(null);
    const input: ResourceActionInput = {
      actorPrincipalId: 'prn_admin',
      organizationSlug: 'organization',
      query: { projectName: 'project', resourceName: 'postgres' },
    };

    const first: Promise<ResourceBackupResult> = createResourceBackupForPrincipal(input);
    await vi.waitFor((): void => {
      expect(runBackup).toHaveBeenCalledTimes(1);
    });
    const second: Promise<ResourceBackupResult> = createResourceBackupForPrincipal(input);
    await vi.waitFor((): void => {
      expect(withResourceOperationLocks).toHaveBeenCalledTimes(2);
    });

    expect(runBackup).toHaveBeenCalledTimes(1);
    finishFirstBackup?.();
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });
});
