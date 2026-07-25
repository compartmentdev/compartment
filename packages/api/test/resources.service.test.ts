import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { isApiBusinessError, mapApiBusinessError } from '../src/errors/api-business-error';
import type { ProjectResourceRow } from '../src/queries/resources.query.types';
import type { ResourceLookupResult } from '../src/services/resources.service.types';
import {
  bootstrapResourceForPrincipal,
  deleteResourceForPrincipal,
  stopResourceForPrincipal,
} from '../src/services/resources.service';

const deleteResource: Mock = vi.hoisted((): Mock => vi.fn());
const findResource: Mock = vi.hoisted((): Mock => vi.fn());
const reconcileReplicas: Mock = vi.hoisted((): Mock => vi.fn());
const resolveContext: Mock = vi.hoisted((): Mock => vi.fn());
type ResourceOperationLock = (
  resourceIds: string[],
  operation: () => Promise<ProjectResourceRow>,
) => Promise<ProjectResourceRow>;
const withResourceOperationLocks: Mock<ResourceOperationLock> = vi.hoisted(
  (): Mock<ResourceOperationLock> => vi.fn<ResourceOperationLock>(),
);

vi.mock('../src/services/resources-kubernetes-reconcile.service', (): object => ({
  bootstrapKubernetesResource: vi.fn(),
  deleteKubernetesResource: deleteResource,
  reconcileKubernetesResourceReplicas: reconcileReplicas,
}));
vi.mock('../src/queries/resources.query', (): object => ({
  findProjectResourceByName: findResource,
  listProjectResourcesByEnvironmentId: vi.fn(),
}));
vi.mock('../src/services/resource-environment-context.service', (): object => ({
  resolveResourceEnvironmentContext: resolveContext,
}));
vi.mock('../src/services/resource-operation-lock.service', (): object => ({
  withResourceOperationLocks,
}));

describe('resource service', (): void => {
  beforeEach((): void => {
    vi.clearAllMocks();
    resolveContext.mockResolvedValue({
      environment: { id: 'env_prod' },
      organization: { id: 'org' },
      project: { id: 'prj' },
    });
    findResource.mockResolvedValue(resource());
    reconcileReplicas.mockResolvedValue(resource());
    let previousOperation: Promise<void> = Promise.resolve();
    withResourceOperationLocks.mockImplementation(
      async (_resourceIds: string[], operation: () => Promise<ProjectResourceRow>): Promise<ProjectResourceRow> => {
        const waitForPrevious: Promise<void> = previousOperation;
        let releaseCurrent: (() => void) | undefined;
        previousOperation = new Promise<void>((resolve: () => void): void => {
          releaseCurrent = resolve;
        });
        await waitForPrevious;
        try {
          return await operation();
        } finally {
          releaseCurrent?.();
        }
      },
    );
  });

  it('does not report retained volumes after a concurrent caller upgraded deletion to destructive', async (): Promise<void> => {
    deleteResource.mockResolvedValue(true);

    await expect(
      deleteResourceForPrincipal({
        actorPrincipalId: 'prn_admin',
        body: { deleteData: false },
        organizationSlug: 'organization',
        query: { projectName: 'project', resourceName: 'postgres' },
      }),
    ).resolves.toEqual([]);
  });

  it('reports an already bootstrapped resource as a conflict', async (): Promise<void> => {
    const error: Error = await bootstrapResourceForPrincipal({
      actorPrincipalId: 'prn_admin',
      organizationSlug: 'organization',
      query: { projectName: 'project', resourceName: 'postgres' },
    }).then(
      (): never => {
        throw new Error('Expected resource bootstrap to fail.');
      },
      (reason: Error): Error => reason,
    );

    if (!isApiBusinessError(error)) {
      throw error;
    }
    expect(mapApiBusinessError(error)).toEqual({
      code: 'resource_conflict',
      message: 'Resource "postgres" is already bootstrapped.',
      statusCode: 409,
    });
  });

  it('serializes resource stop with resource operations', async (): Promise<void> => {
    let releaseOperation: (() => void) | undefined;
    const activeOperation: Promise<ProjectResourceRow> = withResourceOperationLocks(
      ['res_postgres'],
      async (): Promise<ProjectResourceRow> =>
        await new Promise<ProjectResourceRow>((resolve: (value: ProjectResourceRow) => void): void => {
          releaseOperation = (): void => resolve(resource());
        }),
    );

    const stop: Promise<ResourceLookupResult> = stopResourceForPrincipal({
      actorPrincipalId: 'prn_admin',
      organizationSlug: 'organization',
      query: { projectName: 'project', resourceName: 'postgres' },
    });

    await vi.waitFor((): void => {
      expect(findResource).toHaveBeenCalled();
    });
    expect(reconcileReplicas).not.toHaveBeenCalled();
    releaseOperation?.();
    await activeOperation;
    await stop;
    expect(reconcileReplicas).toHaveBeenCalledOnce();
  });
});

function resource(): ProjectResourceRow {
  const now: Date = new Date('2026-07-16T03:00:00.000Z');
  return {
    commandJson: '[]',
    createdAt: now,
    deleteDataRequested: false,
    environmentId: 'env_prod',
    envJson: '{}',
    expectedClaimsJson: '[{"claimName":"data","uid":"uid-data"}]',
    id: 'res_postgres',
    image: 'postgres:16',
    name: 'postgres',
    operationConfigHash: '',
    operationsJson: '{"backup":null,"restore":null}',
    outputsJson: '{}',
    portsJson: '[5432]',
    readinessJson: 'null',
    runtimeDefinitionHash: 'hash',
    status: 'running',
    updatedAt: now,
    volumesJson: '[{"name":"data","mountPath":"/var/lib/postgresql/data"}]',
  };
}
