import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ProjectResourceRow } from '../src/queries/resources.query.types';
import type { ProjectRow } from '../src/queries/projects.query.types';
import { cleanupArchivedProjectRuntime } from '../src/services/project-runtime-cleanup.service';
import type { ResourceEnvironmentContext } from '../src/services/resources.service.types';

const listEnvironments: Mock = vi.hoisted((): Mock => vi.fn());
const listDeployments: Mock = vi.hoisted((): Mock => vi.fn());
const listResources: Mock = vi.hoisted((): Mock => vi.fn());
const findOrganization: Mock = vi.hoisted((): Mock => vi.fn());
const reconcileReplicas: Mock = vi.hoisted((): Mock => vi.fn());
const deleteResource: Mock<
  (context: ResourceEnvironmentContext, resource: ProjectResourceRow, deleteData: boolean) => Promise<void>
> = vi.hoisted(
  (): Mock<(context: ResourceEnvironmentContext, resource: ProjectResourceRow, deleteData: boolean) => Promise<void>> =>
    vi.fn(),
);

vi.mock('../src/queries/deployment-context.query', (): object => ({
  listProjectEnvironmentsByProjectIds: listEnvironments,
}));
vi.mock('../src/queries/deployment-joined.query', (): object => ({
  listRuntimeJoinedDeploymentsForProject: listDeployments,
}));
vi.mock('../src/queries/resources.query', (): object => ({
  listProjectResourcesByEnvironmentId: listResources,
}));
vi.mock('../src/queries/organizations.query', (): object => ({ findOrganizationById: findOrganization }));
vi.mock('../src/services/resources-kubernetes-reconcile.service', (): object => ({
  deleteKubernetesResource: deleteResource,
  reconcileKubernetesResourceReplicas: reconcileReplicas,
}));
vi.mock('../src/runtime/runtime-access', (): object => ({
  getApiConfig: (): object => ({ baseDomain: 'localhost' }),
}));

describe('project runtime cleanup', (): void => {
  beforeEach((): void => {
    vi.clearAllMocks();
    findOrganization.mockResolvedValue({ id: 'org', name: 'Acme', slug: 'acme' });
    listDeployments.mockResolvedValue([]);
    listEnvironments.mockResolvedValue([{ id: 'env', name: 'production', projectId: 'project' }]);
    listResources.mockResolvedValue([{ id: 'resource', name: 'postgres', status: 'deleting' } as ProjectResourceRow]);
    reconcileReplicas.mockRejectedValue(new Error('resource deletion is already in progress'));
    deleteResource.mockResolvedValue(undefined);
  });

  it('converges archive cleanup through an already in-flight resource deletion', async (): Promise<void> => {
    await expect(cleanupArchivedProjectRuntime(project())).resolves.toBeUndefined();

    expect(deleteResource).toHaveBeenCalledTimes(1);
    const [context, resource, deleteData] = deleteResource.mock.calls[0]!;
    expect(context.project.id).toBe('project');
    expect(resource).toMatchObject({ id: 'resource', status: 'deleting' });
    expect(deleteData).toBe(false);
    expect(reconcileReplicas).not.toHaveBeenCalled();
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
