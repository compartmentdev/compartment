import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type {
  createOrGetEnvironment,
  findEnvironmentByProjectAndName,
  findProjectServiceByName,
} from '../src/queries/deployment-context.query';
import type { EnvironmentRow, ProjectServiceRow } from '../src/queries/deployments.query.types';
import type { NodeRow } from '../src/queries/node.query.types';
import type { OrganizationRow } from '../src/queries/organizations.query.types';
import type { createOrGetProject, findProjectByOrganizationAndName } from '../src/queries/projects.query';
import type { ProjectRow } from '../src/queries/projects.query.types';
import {
  findActiveProjectScope,
  resolveActiveProjectScope,
  resolveOrCreateEnvironment,
} from '../src/services/project-scope.service';
import type { resolveRegisteredNode } from '../src/services/node.service';
import type { resolveOrganizationForPrincipal } from '../src/services/organizations.service';

type CreateOrGetEnvironment = typeof createOrGetEnvironment;
type CreateOrGetProject = typeof createOrGetProject;
type FindEnvironmentByProjectAndName = typeof findEnvironmentByProjectAndName;
type FindProjectByOrganizationAndName = typeof findProjectByOrganizationAndName;
type FindProjectServiceByName = typeof findProjectServiceByName;
type ResolveOrganizationForPrincipal = typeof resolveOrganizationForPrincipal;
type ResolveRegisteredNode = typeof resolveRegisteredNode;

interface ProjectScopeServiceTestMocks {
  createOrGetEnvironment: Mock<CreateOrGetEnvironment>;
  createOrGetProject: Mock<CreateOrGetProject>;
  findEnvironmentByProjectAndName: Mock<FindEnvironmentByProjectAndName>;
  findProjectByOrganizationAndName: Mock<FindProjectByOrganizationAndName>;
  findProjectServiceByName: Mock<FindProjectServiceByName>;
  resolveOrganizationForPrincipal: Mock<ResolveOrganizationForPrincipal>;
  resolveRegisteredNode: Mock<ResolveRegisteredNode>;
}

interface DeploymentContextQueryModuleMock {
  createOrGetEnvironment: Mock<CreateOrGetEnvironment>;
  findEnvironmentByProjectAndName: Mock<FindEnvironmentByProjectAndName>;
  findProjectServiceByName: Mock<FindProjectServiceByName>;
}

interface ProjectsQueryModuleMock {
  createOrGetProject: Mock<CreateOrGetProject>;
  findProjectByOrganizationAndName: Mock<FindProjectByOrganizationAndName>;
}

interface OrganizationsServiceModuleMock {
  resolveOrganizationForPrincipal: Mock<ResolveOrganizationForPrincipal>;
}

interface NodeServiceModuleMock {
  resolveRegisteredNode: Mock<ResolveRegisteredNode>;
}

const mocks: ProjectScopeServiceTestMocks = vi.hoisted(
  (): ProjectScopeServiceTestMocks => ({
    createOrGetEnvironment: vi.fn<CreateOrGetEnvironment>(),
    createOrGetProject: vi.fn<CreateOrGetProject>(),
    findEnvironmentByProjectAndName: vi.fn<FindEnvironmentByProjectAndName>(),
    findProjectByOrganizationAndName: vi.fn<FindProjectByOrganizationAndName>(),
    findProjectServiceByName: vi.fn<FindProjectServiceByName>(),
    resolveOrganizationForPrincipal: vi.fn<ResolveOrganizationForPrincipal>(),
    resolveRegisteredNode: vi.fn<ResolveRegisteredNode>(),
  }),
);

vi.mock(
  '../src/queries/deployment-context.query',
  (): DeploymentContextQueryModuleMock => ({
    createOrGetEnvironment: mocks.createOrGetEnvironment,
    findEnvironmentByProjectAndName: mocks.findEnvironmentByProjectAndName,
    findProjectServiceByName: mocks.findProjectServiceByName,
  }),
);

vi.mock(
  '../src/queries/projects.query',
  (): ProjectsQueryModuleMock => ({
    createOrGetProject: mocks.createOrGetProject,
    findProjectByOrganizationAndName: mocks.findProjectByOrganizationAndName,
  }),
);

vi.mock(
  '../src/services/organizations.service',
  (): OrganizationsServiceModuleMock => ({
    resolveOrganizationForPrincipal: mocks.resolveOrganizationForPrincipal,
  }),
);

vi.mock(
  '../src/services/node.service',
  (): NodeServiceModuleMock => ({
    resolveRegisteredNode: mocks.resolveRegisteredNode,
  }),
);

const organization: OrganizationRow = {
  id: 'org_123',
  name: 'Acme Dev',
  slug: 'acme-dev',
};
const activeProject: ProjectRow = {
  archivedAt: null,
  createdAt: new Date('2026-04-07T12:00:00.000Z'),
  id: 'prj_123',
  name: 'billing',
  organizationId: organization.id,
  updatedAt: new Date('2026-04-07T12:00:00.000Z'),
};
const archivedProject: ProjectRow = {
  ...activeProject,
  archivedAt: new Date('2026-04-08T12:00:00.000Z'),
};
const environment: EnvironmentRow = {
  createdAt: new Date('2026-04-07T12:00:00.000Z'),
  id: 'env_123',
  name: 'production',
  nodeId: 'node_123',
  projectId: activeProject.id,
  updatedAt: new Date('2026-04-07T12:00:00.000Z'),
};
const projectService: ProjectServiceRow = {
  createdAt: new Date('2026-04-07T12:00:00.000Z'),
  id: 'svc_123',
  kind: 'worker',
  name: 'worker',
  path: './worker',
  projectId: activeProject.id,
  updatedAt: new Date('2026-04-07T12:00:00.000Z'),
};
const registeredNode: NodeRow = {
  createdAt: new Date('2026-04-07T12:00:00.000Z'),
  id: 'node_123',
  name: 'node-a',
  nodeSocketPath: '/tmp/compartment/api-test/node/project-scope.sock',
  nodeVersion: '1.0.0',
  updatedAt: new Date('2026-04-07T12:00:00.000Z'),
};

describe('project scope service', (): void => {
  beforeEach((): void => {
    mocks.resolveOrganizationForPrincipal.mockResolvedValue(organization);
    mocks.findProjectByOrganizationAndName.mockResolvedValue(activeProject);
    mocks.findEnvironmentByProjectAndName.mockResolvedValue(environment);
    mocks.findProjectServiceByName.mockResolvedValue(projectService);
    mocks.resolveRegisteredNode.mockResolvedValue(registeredNode);
  });

  it('treats archived projects as invalid for active scope resolution', async (): Promise<void> => {
    mocks.findProjectByOrganizationAndName.mockResolvedValueOnce(archivedProject);

    await expect(resolveActiveProjectScope('prn_123', 'acme-dev', 'billing')).rejects.toMatchObject({
      code: 'project_archived',
    });
  });

  it('returns null for optional active project lookups when the project is missing', async (): Promise<void> => {
    mocks.findProjectByOrganizationAndName.mockResolvedValueOnce(undefined);

    await expect(findActiveProjectScope('prn_123', 'acme-dev', 'billing')).resolves.toBeNull();
  });

  it('creates a missing environment through the shared runtime resolution path', async (): Promise<void> => {
    const now: Date = new Date('2026-04-10T12:00:00.000Z');

    mocks.findEnvironmentByProjectAndName.mockResolvedValueOnce(undefined);
    mocks.createOrGetEnvironment.mockResolvedValueOnce(environment);

    const resolvedEnvironment: EnvironmentRow = await resolveOrCreateEnvironment(activeProject.id, 'production', now);

    expect(resolvedEnvironment).toEqual(environment);
    expect(mocks.createOrGetEnvironment).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'production',
        nodeId: 'node_123',
        projectId: 'prj_123',
        updatedAt: now,
      }),
    );
  });
});
