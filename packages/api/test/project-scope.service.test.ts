import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type {
  createOrGetEnvironment,
  findEnvironmentByProjectAndName,
  findProjectServiceByName,
} from '../src/queries/deployment-context.query';
import type { EnvironmentRow, ProjectServiceRow } from '../src/queries/deployments.query.types';
import type { OrganizationRow } from '../src/queries/organizations.query.types';
import type { createOrGetProject, findProjectByOrganizationAndName } from '../src/queries/projects.query';
import type { ProjectRow } from '../src/queries/projects.query.types';
import {
  findActiveProjectScope,
  resolveActiveProjectScope,
  resolveOrCreateActiveProjectScope,
  resolveOrCreateEnvironment,
} from '../src/services/project-scope.service';
import type { resolveOrganizationForPrincipal } from '../src/services/organizations.service';

type CreateOrGetEnvironment = typeof createOrGetEnvironment;
type CreateOrGetProject = typeof createOrGetProject;
type FindEnvironmentByProjectAndName = typeof findEnvironmentByProjectAndName;
type FindProjectByOrganizationAndName = typeof findProjectByOrganizationAndName;
type FindProjectServiceByName = typeof findProjectServiceByName;
type ResolveOrganizationForPrincipal = typeof resolveOrganizationForPrincipal;
type ResolveNewProjectDefaultAccessMode = () => 'authenticated' | 'public';

interface ProjectScopeServiceTestMocks {
  createOrGetEnvironment: Mock<CreateOrGetEnvironment>;
  createOrGetProject: Mock<CreateOrGetProject>;
  findEnvironmentByProjectAndName: Mock<FindEnvironmentByProjectAndName>;
  findProjectByOrganizationAndName: Mock<FindProjectByOrganizationAndName>;
  findProjectServiceByName: Mock<FindProjectServiceByName>;
  resolveOrganizationForPrincipal: Mock<ResolveOrganizationForPrincipal>;
  resolveNewProjectDefaultAccessMode: Mock<ResolveNewProjectDefaultAccessMode>;
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

const mocks: ProjectScopeServiceTestMocks = vi.hoisted(
  (): ProjectScopeServiceTestMocks => ({
    createOrGetEnvironment: vi.fn<CreateOrGetEnvironment>(),
    createOrGetProject: vi.fn<CreateOrGetProject>(),
    findEnvironmentByProjectAndName: vi.fn<FindEnvironmentByProjectAndName>(),
    findProjectByOrganizationAndName: vi.fn<FindProjectByOrganizationAndName>(),
    findProjectServiceByName: vi.fn<FindProjectServiceByName>(),
    resolveOrganizationForPrincipal: vi.fn<ResolveOrganizationForPrincipal>(),
    resolveNewProjectDefaultAccessMode: vi.fn<ResolveNewProjectDefaultAccessMode>(),
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

vi.mock('../src/services/project-default-access-mode.service', () => ({
  resolveNewProjectDefaultAccessMode: mocks.resolveNewProjectDefaultAccessMode,
}));

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

const organization: OrganizationRow = {
  id: 'org_123',
  name: 'Acme Dev',
  slug: 'acme-dev',
};
const activeProject: ProjectRow = {
  archivedAt: null,
  createdAt: new Date('2026-04-07T12:00:00.000Z'),
  defaultAccessMode: 'authenticated',
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
describe('project scope service', (): void => {
  beforeEach((): void => {
    mocks.resolveOrganizationForPrincipal.mockResolvedValue(organization);
    mocks.resolveNewProjectDefaultAccessMode.mockReturnValue('authenticated');
    mocks.findProjectByOrganizationAndName.mockResolvedValue(activeProject);
    mocks.findEnvironmentByProjectAndName.mockResolvedValue(environment);
    mocks.findProjectServiceByName.mockResolvedValue(projectService);
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
        projectId: 'prj_123',
        updatedAt: now,
      }),
    );
  });

  it('persists the resolved install default when normal deploy creates a project', async (): Promise<void> => {
    const now: Date = new Date('2026-04-10T12:00:00.000Z');
    const publicProject: ProjectRow = { ...activeProject, defaultAccessMode: 'public' };
    mocks.findProjectByOrganizationAndName.mockResolvedValueOnce(undefined);
    mocks.resolveNewProjectDefaultAccessMode.mockReturnValueOnce('public');
    mocks.createOrGetProject.mockResolvedValueOnce(publicProject);

    await expect(resolveOrCreateActiveProjectScope('prn_123', 'acme-dev', 'billing', now)).resolves.toMatchObject({
      project: publicProject,
    });
    expect(mocks.createOrGetProject).toHaveBeenCalledWith(
      expect.objectContaining({ defaultAccessMode: 'public', name: 'billing', updatedAt: now }),
    );
  });
});
