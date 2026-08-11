import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ProjectResourceRow, ProjectResourceRowStatus } from '../src/queries/resources.query.types';
import { prepareRestoredResourceRuntime } from '../src/services/resource-backups.restore-as-kubernetes.service';
import type { ResourceEnvironmentContext } from '../src/services/resources.service.types';

const bootstrapResource: Mock = vi.hoisted((): Mock => vi.fn());
const findResource: Mock = vi.hoisted((): Mock => vi.fn());
const waitForBootstrap: Mock = vi.hoisted((): Mock => vi.fn());
const waitForRunning: Mock = vi.hoisted((): Mock => vi.fn());

vi.mock('../src/queries/resources.query', (): object => ({
  createProjectResourceWithExecutor: vi.fn(),
  findProjectResourceById: findResource,
}));
vi.mock('../src/services/resources-resource-insert.service', (): object => ({ createResourceInsert: vi.fn() }));
vi.mock('../src/services/resources-kubernetes-reconcile.service', (): object => ({
  bootstrapKubernetesResource: bootstrapResource,
}));
vi.mock('../src/services/resource-reconcile-run.service', (): object => ({
  waitForResourceBootstrap: waitForBootstrap,
  waitForResourceRunning: waitForRunning,
}));

describe('restore-as Kubernetes preparation', (): void => {
  beforeEach((): void => {
    vi.clearAllMocks();
    bootstrapResource.mockResolvedValue(undefined);
    findResource.mockResolvedValue(resource('stopped'));
    waitForBootstrap.mockResolvedValue(resource('stopped'));
  });

  it('waits for the resource to become running beyond the old fixed two-minute boundary', async (): Promise<void> => {
    vi.useFakeTimers();
    try {
      let completeRunning: ((value: ProjectResourceRow) => void) | undefined;
      waitForRunning.mockReturnValue(
        new Promise<ProjectResourceRow>((resolve: (value: ProjectResourceRow) => void): void => {
          completeRunning = resolve;
        }),
      );
      let settled: boolean = false;
      const preparation: Promise<ProjectResourceRow> = prepareRestoredResourceRuntime(context(), resource('stopped'));
      void preparation.finally((): void => {
        settled = true;
      });
      await vi.waitFor((): void => {
        expect(waitForRunning).toHaveBeenCalledWith('res_postgres_copy');
      });

      await vi.advanceTimersByTimeAsync(120_001);
      expect(settled).toBe(false);
      const running: ProjectResourceRow = resource('running');
      completeRunning?.(running);
      await expect(preparation).resolves.toBe(running);
    } finally {
      vi.useRealTimers();
    }
  });
});

function resource(status: ProjectResourceRowStatus): ProjectResourceRow {
  return {
    commandJson: '[]',
    createdAt: new Date(),
    deleteDataRequested: false,
    envJson: '[]',
    environmentId: 'env_prod',
    expectedClaimsJson: '[{"claimName":"data","uid":"uid-data"}]',
    id: 'res_postgres_copy',
    image: 'postgres:16',
    name: 'postgres-copy',
    operationConfigHash: 'operation',
    operationsJson: '{}',
    outputsJson: '{}',
    portsJson: '[5432]',
    readinessJson: 'null',
    runtimeDefinitionHash: 'runtime',
    status,
    updatedAt: new Date(),
    volumesJson: '[]',
  };
}

function context(): ResourceEnvironmentContext {
  return {
    environment: { createdAt: new Date(), id: 'env_prod', name: 'production', projectId: 'prj', updatedAt: new Date() },
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
