import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ProjectResourceRow, ResourceTransaction } from '../src/queries/resources.query.types';
import {
  createResourceBackupForPrincipal,
  runDueScheduledResourceBackup,
} from '../src/services/resource-backups.service';
import type {
  ResourceActionInput,
  ResourceBackupResult,
  ResourceEnvironmentContext,
  ScheduledResourceBackupRunResult,
} from '../src/services/resources.service.types';

type TestTransactionCallback = (tx: ResourceTransaction) => Promise<ResourceBackupResult>;
type TestTransaction = (run: TestTransactionCallback) => Promise<ResourceBackupResult>;

const lockReconciliation: Mock = vi.hoisted((): Mock => vi.fn());
const applyRetention: Mock = vi.hoisted((): Mock => vi.fn());
const lockResource: Mock = vi.hoisted((): Mock => vi.fn());
const listBackups: Mock = vi.hoisted((): Mock => vi.fn());
const resolveContext: Mock = vi.hoisted((): Mock => vi.fn());
const runBackup: Mock = vi.hoisted((): Mock => vi.fn());
const transaction: Mock<TestTransaction> = vi.hoisted((): Mock<TestTransaction> => vi.fn());
const waitForBootstrap: Mock = vi.hoisted((): Mock => vi.fn());
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
vi.mock('../src/queries/resource-backups.query', (): object => ({
  listResourceBackups: listBackups,
}));
vi.mock('../src/runtime/runtime-access', (): object => ({
  getApiDatabase: (): object => ({ transaction }),
}));
vi.mock('../src/services/resource-backups.retention.service', (): object => ({
  applyResourceBackupRetention: applyRetention,
}));
vi.mock('../src/services/resource-reconcile-run.service', (): object => ({
  waitForResourceClaimIdentities: waitForBootstrap,
}));
vi.mock('../src/services/resource-operation-lock.service', (): object => ({
  withResourceOperationLocks,
}));

describe('resource backup archive boundary', (): void => {
  beforeEach((): void => {
    vi.clearAllMocks();
    applyRetention.mockResolvedValue({ attempted: false, cleanedBackups: [], recordedFailure: false });
    resolveContext.mockResolvedValue({
      environment: { id: 'env_prod' },
      organization: { id: 'org' },
      project: { id: 'prj' },
    });
    transaction.mockImplementation(
      async (run: TestTransactionCallback): Promise<ResourceBackupResult> => await run({} as ResourceTransaction),
    );
    lockResource.mockResolvedValue(resourceRow('[{"claimName":"volume-backups","uid":"uid-backups"}]'));
    listBackups.mockResolvedValue([]);
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

  it('waits for persisted PVC identity before starting a manual backup', async (): Promise<void> => {
    const bootstrapped: ProjectResourceRow = resourceRow('[{"claimName":"volume-backups","uid":"uid-backups"}]');
    lockReconciliation.mockResolvedValue(null);
    lockResource.mockResolvedValueOnce(resourceRow('[]')).mockResolvedValue(bootstrapped);
    waitForBootstrap.mockResolvedValue(bootstrapped);
    runBackup.mockResolvedValue({ backup: {}, manifest: null });

    const result: ResourceBackupResult = await createResourceBackupForPrincipal({
      actorPrincipalId: 'prn_admin',
      organizationSlug: 'organization',
      query: { projectName: 'project', resourceName: 'postgres' },
    });

    expect(result.resource).toBe(bootstrapped);
    expect(waitForBootstrap).toHaveBeenCalledWith('res_postgres');
    expect(runBackup).toHaveBeenCalledWith(expect.objectContaining({ resource: bootstrapped }));
  });

  it('waits for persisted PVC identity before starting a scheduled backup', async (): Promise<void> => {
    const bootstrapped: ProjectResourceRow = resourceRow('[{"claimName":"volume-backups","uid":"uid-backups"}]');
    lockReconciliation.mockResolvedValue(null);
    lockResource.mockResolvedValueOnce(resourceRow('[]')).mockResolvedValue(bootstrapped);
    waitForBootstrap.mockResolvedValue(bootstrapped);
    runBackup.mockResolvedValue({ backup: {}, manifest: null });

    const result: ScheduledResourceBackupRunResult | null = await runDueScheduledResourceBackup(
      {
        environment: { id: 'env_prod' },
        organization: { id: 'org' },
        project: { id: 'prj' },
      } as ResourceEnvironmentContext,
      'postgres',
      new Date('2026-07-21T12:00:00.000Z'),
    );

    expect(result?.resource).toBe(bootstrapped);
    expect(waitForBootstrap).toHaveBeenCalledWith('res_postgres');
    expect(runBackup).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'scheduled', resource: bootstrapped }));
  });

  it('retries identity observation when the resource is still unfenced under the operation lock', async (): Promise<void> => {
    const waiting: ProjectResourceRow = resourceRow('[]');
    const bootstrapped: ProjectResourceRow = resourceRow('[{"claimName":"volume-backups","uid":"uid-backups"}]');
    lockReconciliation.mockResolvedValue(null);
    lockResource.mockResolvedValueOnce(waiting).mockResolvedValueOnce(waiting).mockResolvedValueOnce(bootstrapped);
    waitForBootstrap.mockResolvedValue(bootstrapped);
    runBackup.mockResolvedValue({ backup: {}, manifest: null });

    const result: ResourceBackupResult = await createResourceBackupForPrincipal({
      actorPrincipalId: 'prn_admin',
      organizationSlug: 'organization',
      query: { projectName: 'project', resourceName: 'postgres' },
    });

    expect(result.resource).toBe(bootstrapped);
    expect(waitForBootstrap).toHaveBeenCalledTimes(2);
    expect(waitForBootstrap).toHaveBeenNthCalledWith(1, 'res_postgres');
    expect(waitForBootstrap).toHaveBeenNthCalledWith(2, 'res_postgres');
    expect(runBackup).toHaveBeenCalledOnce();
    expect(runBackup).toHaveBeenCalledWith(expect.objectContaining({ resource: bootstrapped }));
  });

  it('refuses to enqueue resource-operation work after deletion has started', async (): Promise<void> => {
    lockReconciliation.mockResolvedValue(null);
    lockResource.mockResolvedValue({ ...resourceRow('[]'), status: 'deleting' });

    await expect(
      createResourceBackupForPrincipal({
        actorPrincipalId: 'prn_admin',
        organizationSlug: 'organization',
        query: { projectName: 'project', resourceName: 'postgres' },
      }),
    ).rejects.toMatchObject({ code: 'resource_not_found' });

    expect(runBackup).not.toHaveBeenCalled();
    expect(waitForBootstrap).not.toHaveBeenCalled();
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

function resourceRow(expectedClaimsJson: string): ProjectResourceRow {
  return {
    commandJson: '[]',
    createdAt: new Date('2026-07-21T10:00:00.000Z'),
    deleteDataRequested: false,
    envJson: '[]',
    environmentId: 'env_prod',
    expectedClaimsJson,
    id: 'res_postgres',
    image: 'postgres:16-alpine',
    name: 'postgres',
    operationConfigHash: 'operations',
    operationsJson:
      '{"backup":{"command":"pg_dump","env":[],"image":null,"schedule":{"cron":"* * * * *","retention":{"includeManual":true,"keepLast":2}}},"restore":null}',
    outputsJson: '{}',
    portsJson: '[5432]',
    readinessJson: 'null',
    runtimeDefinitionHash: 'runtime',
    status: 'running',
    updatedAt: new Date('2026-07-21T10:00:00.000Z'),
    volumesJson: '{}',
  };
}
