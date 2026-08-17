import type { ResourceReconcileIntent, TenantSecretEnvironment } from '@compartment/contracts';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ProjectResourceRow, ResourceTransaction } from '../src/queries/resources.query.types';
import type { EffectiveVariable } from '../src/services/effective-variables.service.types';
import type { ResourceReconcileRunState } from '../src/queries/resource-reconcile-runs.query.types';
import {
  bootstrapKubernetesResource,
  deleteKubernetesResource,
  reconcileKubernetesResource,
  reconcileKubernetesResourceReplicas,
} from '../src/services/resources-kubernetes-reconcile.service';
import type { ResourceEnvironmentContext } from '../src/services/resources.service.types';
import { decryptTenantVariableValueFromStorage } from '../src/lib/variables-crypto';
import { resolveResourceIntent } from '../src/services/resources.service.helpers';

type LoadVariables = (
  environmentId: string,
  organizationId: string,
  resourceName: string,
) => Promise<EffectiveVariable[]>;
type RequestBootstrap = (operationId: string, intent: ResourceReconcileIntent) => Promise<void>;
type RequestReconcile = (
  tx: ResourceTransaction,
  operationId: string,
  intent: ResourceReconcileIntent,
  resource: ProjectResourceRow,
) => Promise<void>;
type TestTransactionCallback = (tx: ResourceTransaction) => Promise<ProjectResourceRow>;
type TestTransaction = (callback: TestTransactionCallback) => Promise<ProjectResourceRow>;
type DecryptedTestEnvironment = Record<string, string>;

const loadVariables: Mock<LoadVariables> = vi.hoisted((): Mock<LoadVariables> => vi.fn());
const requestBootstrap: Mock<RequestBootstrap> = vi.hoisted((): Mock<RequestBootstrap> => vi.fn());
const requestReconcile: Mock<RequestReconcile> = vi.hoisted((): Mock<RequestReconcile> => vi.fn());
const requestStandaloneReconcile: Mock = vi.hoisted((): Mock => vi.fn());
const readLatestDeletion: Mock = vi.hoisted((): Mock => vi.fn());
const finalizeDeletion: Mock = vi.hoisted((): Mock => vi.fn());
const waitForBootstrap: Mock = vi.hoisted((): Mock => vi.fn());
const waitForBootstrapCleanup: Mock = vi.hoisted((): Mock => vi.fn());
const waitForReconcile: Mock = vi.hoisted((): Mock => vi.fn());
const lockResource: Mock = vi.hoisted((): Mock => vi.fn());
const beginDeletion: Mock = vi.hoisted((): Mock => vi.fn());
const updateBootstrapIntent: Mock = vi.hoisted((): Mock => vi.fn());
const findResource: Mock = vi.hoisted((): Mock => vi.fn());
const updateStatus: Mock = vi.hoisted((): Mock => vi.fn());
const lockReconciliation: Mock = vi.hoisted((): Mock => vi.fn());
const persistIntent: Mock = vi.hoisted((): Mock => vi.fn());
const prepareVariables: Mock = vi.hoisted((): Mock => vi.fn());
const transaction: Mock<TestTransaction> = vi.hoisted((): Mock<TestTransaction> => vi.fn());
const withResourceOperationLocks: Mock = vi.hoisted((): Mock => vi.fn());
const readLatestReconcile: Mock<
  (tx: ResourceTransaction, resourceId: string) => Promise<ResourceReconcileRunState | null>
> = vi.hoisted((): Mock => vi.fn());

vi.mock('../src/services/resources-effective-variables.service', (): object => ({
  loadResourceEffectiveVariables: loadVariables,
}));
vi.mock('../src/queries/resource-reconcile-create.query', (): object => ({
  updateActiveResourceBootstrapIntent: updateBootstrapIntent,
}));
vi.mock('../src/queries/resource-reconcile-runs.query', (): object => ({
  readLatestResourceReconcileRunStateWithExecutor: readLatestReconcile,
}));
vi.mock('../src/queries/resource-reconcile-deletion.query', (): object => ({
  finalizeProjectResourceDeletion: finalizeDeletion,
  readLatestResourceDeletionRun: readLatestDeletion,
}));
vi.mock('../src/services/resource-reconcile-run.service', (): object => ({
  requestResourceBootstrap: requestBootstrap,
  requestResourceReconcile: requestStandaloneReconcile,
  requestResourceReconcileWithExecutor: requestReconcile,
  waitForResourceBootstrap: waitForBootstrap,
  waitForResourceBootstrapForCleanup: waitForBootstrapCleanup,
  waitForResourceReconcile: waitForReconcile,
}));
vi.mock('../src/queries/resources.query', (): object => ({
  beginProjectResourceDeletion: beginDeletion,
  findProjectResourceById: findResource,
  lockProjectResourceByName: lockResource,
  lockProjectResourceReconciliation: lockReconciliation,
  updateProjectResourceStatus: updateStatus,
}));
vi.mock('../src/services/resources-reconcile-persistence.service', (): object => ({
  persistResourceIntent: persistIntent,
  prepareResourceEffectiveVariables: prepareVariables,
}));
vi.mock('../src/runtime/runtime-access', (): object => ({
  getApiConfig: (): object => ({
    tenantSecretsKek: Buffer.alloc(32, 1),
    variablesMasterKey: Buffer.alloc(32, 2),
  }),
  getApiDatabase: (): object => ({ transaction }),
}));
vi.mock('../src/services/resource-operation-lock.service', (): object => ({
  withResourceOperationLocks,
}));

describe('Kubernetes resource reconcile boundary', (): void => {
  beforeEach((): void => {
    vi.clearAllMocks();
    requestBootstrap.mockResolvedValue();
    requestReconcile.mockResolvedValue();
    requestStandaloneReconcile.mockResolvedValue(undefined);
    readLatestDeletion.mockResolvedValue(null);
    finalizeDeletion.mockResolvedValue({ deleteData: true, finalized: true });
    waitForReconcile.mockResolvedValue(undefined);
    waitForBootstrapCleanup.mockResolvedValue(resource());
    lockResource.mockResolvedValue(undefined);
    lockReconciliation.mockResolvedValue(null);
    beginDeletion.mockResolvedValue(resource());
    updateBootstrapIntent.mockResolvedValue(undefined);
    findResource.mockResolvedValue(resource());
    updateStatus.mockResolvedValue(resource());
    persistIntent.mockResolvedValue(resource());
    prepareVariables.mockResolvedValue([]);
    readLatestReconcile.mockResolvedValue({ failureMessage: null, phase: 'succeeded' });
    loadVariables.mockResolvedValue([]);
    transaction.mockImplementation(
      async (callback: TestTransactionCallback): Promise<ProjectResourceRow> =>
        await callback({} as ResourceTransaction),
    );
    withResourceOperationLocks.mockImplementation(
      async (_resourceIds: string[], operation: () => Promise<ProjectResourceRow>): Promise<ProjectResourceRow> =>
        await operation(),
    );
  });

  it('projects current effective variables into the explicit bootstrap Secret intent', async (): Promise<void> => {
    loadVariables.mockResolvedValue([effectiveVariable('POSTGRES_PASSWORD', 'generated-secret')]);

    await bootstrapKubernetesResource(context(), resource());

    expect(loadVariables).toHaveBeenCalledWith('env_prod', 'org', 'postgres');
    const encryptedEnvironment: TenantSecretEnvironment | undefined = requestBootstrap.mock.calls[0]?.[1].env;
    const decryptedEnvironment: DecryptedTestEnvironment = decryptTestEnvironment(encryptedEnvironment);
    expect(decryptedEnvironment).toEqual({
      POSTGRES_DB: 'app',
      POSTGRES_PASSWORD: 'generated-secret',
    });
    expect(requestBootstrap.mock.calls[0]?.[1]).toMatchObject({
      command: [],
      ports: [5432],
      readiness: null,
    });
  });

  it('refuses descriptor reconciliation after its project is archived', async (): Promise<void> => {
    lockReconciliation.mockResolvedValue(new Date('2026-07-15T12:00:00.000Z'));

    await expect(
      reconcileKubernetesResource('prn_admin', context(), 'postgres', { image: 'postgres:16' }),
    ).rejects.toMatchObject({ code: 'project_archived' });

    expect(persistIntent).not.toHaveBeenCalled();
    expect(requestReconcile).not.toHaveBeenCalled();
  });

  it('defers every new resource until the implicit backup claim is bootstrapped', async (): Promise<void> => {
    await reconcileKubernetesResource('prn_admin', context(), 'postgres', {
      image: 'postgres:16',
      ports: [5432],
    });

    expect(requestReconcile).not.toHaveBeenCalled();
    expect(updateBootstrapIntent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ image: 'postgres:16' }),
    );
  });

  it('persists an unchanged running resource without queueing a disruptive reconcile', async (): Promise<void> => {
    const existing: ProjectResourceRow = runningResource();
    lockResource.mockResolvedValue(existing);
    persistIntent.mockResolvedValue(existing);

    await reconcileKubernetesResource('prn_admin', context(), 'postgres', { image: 'postgres:16' });

    expect(persistIntent).toHaveBeenCalledOnce();
    expect(readLatestReconcile).toHaveBeenCalledWith(expect.anything(), existing.id);
    expect(requestReconcile).not.toHaveBeenCalled();
  });

  it('retries an unchanged resource after its latest reconcile failed', async (): Promise<void> => {
    const existing: ProjectResourceRow = runningResource();
    lockResource.mockResolvedValue(existing);
    persistIntent.mockResolvedValue(existing);
    readLatestReconcile.mockResolvedValue({ failureMessage: 'replacement failed', phase: 'failed' });

    await reconcileKubernetesResource('prn_admin', context(), 'postgres', { image: 'postgres:16' });

    expect(requestReconcile).toHaveBeenCalledOnce();
  });

  it('queues a real runtime change for an active resource', async (): Promise<void> => {
    const existing: ProjectResourceRow = runningResource();
    lockResource.mockResolvedValue(existing);
    persistIntent.mockResolvedValue({ ...existing, image: 'postgres:17' });

    await reconcileKubernetesResource('prn_admin', context(), 'postgres', { image: 'postgres:17' });

    expect(requestReconcile).toHaveBeenCalledOnce();
  });

  it('queues a readiness change that is outside the runtime hash', async (): Promise<void> => {
    const existing: ProjectResourceRow = runningResource();
    lockResource.mockResolvedValue(existing);
    persistIntent.mockResolvedValue({
      ...existing,
      readinessJson: JSON.stringify({ port: 5432, timeoutMs: 60_000, type: 'tcp' }),
    });

    await reconcileKubernetesResource('prn_admin', context(), 'postgres', {
      image: 'postgres:16',
      readiness: { port: 5432, timeoutMs: 60_000, type: 'tcp' },
    });

    expect(requestReconcile).toHaveBeenCalledOnce();
  });

  it('queues an unchanged stopped resource so deploy reconciliation can start it', async (): Promise<void> => {
    const existing: ProjectResourceRow = { ...runningResource(), status: 'stopped' };
    lockResource.mockResolvedValue(existing);
    persistIntent.mockResolvedValue(existing);

    await reconcileKubernetesResource('prn_admin', context(), 'postgres', { image: 'postgres:16' });

    expect(requestReconcile).toHaveBeenCalledOnce();
  });

  it('finishes deletion when terminal provisioning failed before the namespace existed', async (): Promise<void> => {
    const unprovisioned: ProjectResourceRow = {
      ...resource(),
      deleteDataRequested: true,
      expectedClaimsJson: '[]',
      status: 'deleting',
    };
    beginDeletion.mockResolvedValue(unprovisioned);
    waitForBootstrap.mockRejectedValue(new Error('Project is unprovisionable'));
    waitForBootstrapCleanup.mockResolvedValue(unprovisioned);

    await expect(deleteKubernetesResource(context(), unprovisioned, true)).resolves.toBe(true);

    expect(waitForBootstrapCleanup).toHaveBeenCalledWith(unprovisioned.id);
    expect(waitForBootstrap).not.toHaveBeenCalled();
    expect(requestStandaloneReconcile).not.toHaveBeenCalled();
  });

  it('fences the transition to deleting against complete resource-operation workflows', async (): Promise<void> => {
    const unprovisioned: ProjectResourceRow = {
      ...resource(),
      deleteDataRequested: true,
      expectedClaimsJson: '[]',
      status: 'deleting',
    };
    beginDeletion.mockResolvedValue(unprovisioned);

    await deleteKubernetesResource(context(), resource(), true);

    expect(withResourceOperationLocks).toHaveBeenCalledWith(['res_postgres'], expect.any(Function));
  });

  it('recovers a succeeded delete after the API crashed before removing the resource row', async (): Promise<void> => {
    const deleting: ProjectResourceRow = {
      ...resource(),
      deleteDataRequested: true,
      expectedClaimsJson: '[{"claimName":"data","uid":"uid-data"}]',
      status: 'deleting',
    };
    beginDeletion.mockResolvedValue(deleting);
    readLatestDeletion.mockResolvedValue({ deleteData: true, operationId: 'delete-complete', phase: 'succeeded' });

    await expect(deleteKubernetesResource(context(), deleting, true)).resolves.toBe(true);

    expect(requestStandaloneReconcile).not.toHaveBeenCalled();
    expect(waitForReconcile).not.toHaveBeenCalled();
  });

  it('upgrades a recovered metadata-only delete when the retry requests PVC deletion', async (): Promise<void> => {
    const deleting: ProjectResourceRow = {
      ...resource(),
      deleteDataRequested: true,
      expectedClaimsJson: '[{"claimName":"data","uid":"uid-data"}]',
      status: 'deleting',
    };
    beginDeletion.mockResolvedValue(deleting);
    readLatestDeletion.mockResolvedValue({ deleteData: false, operationId: 'delete-complete', phase: 'succeeded' });

    await deleteKubernetesResource(context(), deleting, true);

    expect(requestStandaloneReconcile).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ deleteData: true, operation: 'delete' }),
      deleting,
    );
  });

  it('continues a metadata-only deletion when a concurrent caller durably upgrades it to delete data', async (): Promise<void> => {
    const metadataOnly: ProjectResourceRow = {
      ...resource(),
      expectedClaimsJson: '[{"claimName":"data","uid":"uid-data"}]',
      status: 'deleting',
    };
    const deleteData: ProjectResourceRow = { ...metadataOnly, deleteDataRequested: true };
    beginDeletion.mockResolvedValue(metadataOnly);
    findResource.mockResolvedValue(deleteData);
    finalizeDeletion
      .mockResolvedValueOnce({ deleteData: null, finalized: false })
      .mockResolvedValueOnce({ deleteData: true, finalized: true });

    await expect(deleteKubernetesResource(context(), metadataOnly, false)).resolves.toBe(true);

    expect(requestStandaloneReconcile).toHaveBeenCalledTimes(2);
    expect(requestStandaloneReconcile.mock.calls[1]?.[1]).toMatchObject({
      deleteData: true,
      operation: 'delete',
    });
  });

  it('reports retained data when another metadata-only caller removed the resource row', async (): Promise<void> => {
    const deleting: ProjectResourceRow = {
      ...resource(),
      expectedClaimsJson: '[{"claimName":"data","uid":"uid-data"}]',
      status: 'deleting',
    };
    beginDeletion.mockResolvedValue(deleting);
    finalizeDeletion
      .mockResolvedValueOnce({ deleteData: null, finalized: false })
      .mockResolvedValueOnce({ deleteData: false, finalized: true });
    findResource.mockResolvedValue(undefined);

    await expect(deleteKubernetesResource(context(), deleting, false)).resolves.toBe(false);
  });

  it('rejects volume additions that cannot be covered by the bootstrapped PVC identity set', async (): Promise<void> => {
    lockResource.mockResolvedValue(resource());

    await expect(
      reconcileKubernetesResource('prn_admin', context(), 'postgres', {
        image: 'postgres:16',
        volumes: { data: '/var/lib/postgresql/data' },
      }),
    ).rejects.toThrow('cannot be added');

    expect(persistIntent).not.toHaveBeenCalled();
  });

  it('does not finish deletion while an in-flight bootstrap still owns PVC creation', async (): Promise<void> => {
    let completeBootstrap: ((value: ProjectResourceRow) => void) | undefined;
    waitForBootstrapCleanup.mockReturnValue(
      new Promise<ProjectResourceRow>((resolve: (value: ProjectResourceRow) => void): void => {
        completeBootstrap = resolve;
      }),
    );
    let settled: boolean = false;

    const deletion: Promise<boolean> = deleteKubernetesResource(context(), resource(), true).finally((): void => {
      settled = true;
    });
    await Promise.resolve();

    expect(settled).toBe(false);
    completeBootstrap?.({
      ...resource(),
      expectedClaimsJson: JSON.stringify([{ claimName: 'backup-artifacts', uid: 'uid-backup' }]),
    });
    await deletion;
    expect(requestStandaloneReconcile).toHaveBeenCalledOnce();
  });

  it('returns the state persisted by reconcile completion without a second unfenced status write', async (): Promise<void> => {
    const bootstrapped: ProjectResourceRow = {
      ...resource(),
      expectedClaimsJson: JSON.stringify([{ claimName: 'backup-artifacts', uid: 'uid-backup' }]),
    };
    findResource.mockResolvedValue({ ...bootstrapped, status: 'running' });

    await expect(reconcileKubernetesResourceReplicas(context(), bootstrapped, 1)).resolves.toMatchObject({
      status: 'running',
    });

    expect(updateStatus).not.toHaveBeenCalled();
  });
});

function decryptTestEnvironment(environment: TenantSecretEnvironment | undefined): DecryptedTestEnvironment {
  const decrypted: DecryptedTestEnvironment = {};
  for (const [name, value] of Object.entries(environment ?? {})) {
    decrypted[name] = decryptTenantVariableValueFromStorage(
      value.valueCiphertext,
      value.encryptionKeyId,
      Buffer.alloc(32, 1),
    );
  }
  return decrypted;
}

function effectiveVariable(keyName: string, value: string): EffectiveVariable {
  return {
    keyName,
    scopeResourceName: 'postgres',
    scopeServiceName: null,
    scopeType: 'resource',
    sensitivity: 'sensitive',
    sourceResourceOutput: null,
    sourceType: 'direct',
    sourceVariableSetName: null,
    value,
  };
}

function resource(): ProjectResourceRow {
  return {
    commandJson: '[]',
    createdAt: new Date(),
    deleteDataRequested: false,
    envJson: '[{"keyName":"POSTGRES_DB","literalValue":"app","sourceType":"literal","variableName":null}]',
    environmentId: 'env_prod',
    expectedClaimsJson: '[]',
    id: 'res_postgres',
    image: 'postgres:16',
    name: 'postgres',
    operationConfigHash: 'operation',
    operationsJson: '{}',
    outputsJson: '{}',
    portsJson: '[5432]',
    readinessJson: 'null',
    runtimeDefinitionHash: 'runtime',
    status: 'running',
    updatedAt: new Date(),
    volumesJson: '[]',
  };
}

function runningResource(): ProjectResourceRow {
  const runtimeDefinitionHash: string = resolveResourceIntent('postgres', { image: 'postgres:16' }, []).runtimeHash;
  return {
    ...resource(),
    expectedClaimsJson: '[{"claimName":"data","uid":"uid-data"}]',
    runtimeDefinitionHash,
  };
}

function context(): ResourceEnvironmentContext {
  return {
    environment: {
      createdAt: new Date(),
      id: 'env_prod',
      name: 'production',
      projectId: 'prj',
      updatedAt: new Date(),
    },
    organization: { id: 'org', name: 'Organization', slug: 'organization' },
    project: {
      archivedAt: null,
      createdAt: new Date(),
      defaultAccessMode: 'authenticated',
      id: 'prj',
      name: 'project',
      organizationId: 'org',
      updatedAt: new Date(),
    },
  };
}
