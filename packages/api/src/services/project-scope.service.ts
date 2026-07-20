import type { PermissionKey } from '@compartment/contracts';
import {
  createEnvironmentNotFoundError,
  createOrganizationNotFoundError,
  createProjectArchivedError,
  createProjectNotFoundError,
  createServiceNotFoundError,
} from '../errors/api-business-error';
import { createId } from '../lib/tokens';
import {
  createOrGetEnvironment,
  findEnvironmentByProjectAndName,
  findProjectServiceByName,
} from '../queries/deployment-context.query';
import type { EnvironmentRow, ProjectServiceRow } from '../queries/deployments.query.types';
import type { OrganizationRow } from '../queries/organizations.query.types';
import { createOrGetProject, findProjectByOrganizationAndName } from '../queries/projects.query';
import type { ProjectRow } from '../queries/projects.query.types';
import { resolveOrganizationForPrincipal } from './organizations.service';
import { requireScopedPermission } from './access-scope.service';
import type { ProjectScopePermissionOptions, ResolvedProjectScope } from './project-scope.service.types';

export async function resolveActiveProjectScope(
  principalId: string,
  organizationSlug: string,
  projectName: string,
  options: ProjectScopePermissionOptions = {},
): Promise<ResolvedProjectScope> {
  const projectScope: ResolvedProjectScope = await resolveRequiredProjectScope(
    principalId,
    organizationSlug,
    projectName,
    options,
  );

  return {
    organization: projectScope.organization,
    project: requireActiveProject(projectScope.project),
  };
}

export async function resolveRequiredProjectScope(
  principalId: string,
  organizationSlug: string,
  projectName: string,
  options: ProjectScopePermissionOptions = {},
): Promise<ResolvedProjectScope> {
  const projectScope: ResolvedProjectScope | null = await findProjectScope(principalId, organizationSlug, projectName);
  if (projectScope === null) {
    throw createProjectNotFoundError();
  }
  if (options.permission !== undefined) {
    await requireScopedPermission({
      organizationId: projectScope.organization.id,
      permission: options.permission,
      principalId,
      routeScope: {
        scopeId: projectScope.project.id,
        scopeType: 'project',
      },
    });
  }

  return projectScope;
}

export async function findActiveProjectScope(
  principalId: string,
  organizationSlug: string,
  projectName: string,
  options: ProjectScopePermissionOptions = {},
): Promise<ResolvedProjectScope | null> {
  const projectScope: ResolvedProjectScope | null = await findProjectScope(principalId, organizationSlug, projectName);
  if (projectScope === null) {
    return null;
  }
  await requireProjectScopePermission(principalId, projectScope, options.permission);

  return {
    organization: projectScope.organization,
    project: requireActiveProject(projectScope.project),
  };
}

export async function resolveOrCreateActiveProjectScope(
  principalId: string,
  organizationSlug: string,
  projectName: string,
  now: Date,
  options: ProjectScopePermissionOptions = {},
): Promise<ResolvedProjectScope> {
  const organization: OrganizationRow = await resolveRequiredOrganization(principalId, organizationSlug);
  const existingProject: ProjectRow | undefined = await findProjectByOrganizationAndName(organization.id, projectName);
  await requireExistingProjectScopePermission(principalId, organization.id, existingProject, options.permission);
  await requireProjectCreatePermission(principalId, organization.id, existingProject, options.createPermission);
  const project: ProjectRow = requireActiveProject(
    await createOrGetProject({
      id: createId('prj'),
      name: projectName,
      organizationId: organization.id,
      updatedAt: now,
    }),
  );

  return {
    organization,
    project,
  };
}

export async function resolveExistingEnvironment(projectId: string, environmentName: string): Promise<EnvironmentRow> {
  return (await findEnvironmentByProjectAndName(projectId, environmentName)) ?? failEnvironmentLookup();
}

export async function resolveOrCreateEnvironment(
  projectId: string,
  environmentName: string,
  now: Date,
): Promise<EnvironmentRow> {
  const existingEnvironment: EnvironmentRow | undefined = await findEnvironmentByProjectAndName(
    projectId,
    environmentName,
  );
  if (existingEnvironment !== undefined) {
    return existingEnvironment;
  }

  return await createOrGetEnvironment({
    id: createId('env'),
    name: environmentName,
    projectId,
    updatedAt: now,
  });
}

export async function resolveRequiredProjectService(
  projectId: string,
  serviceName: string,
): Promise<ProjectServiceRow> {
  return (await findProjectServiceByName(projectId, serviceName)) ?? failMissingProjectService();
}

function requireActiveProject(project: ProjectRow | undefined): ProjectRow {
  const existingProject: ProjectRow = requireProject(project);
  if (existingProject.archivedAt !== null) {
    throw createProjectArchivedError();
  }

  return existingProject;
}

function requireProject(project: ProjectRow | undefined): ProjectRow {
  if (project === undefined) {
    throw createProjectNotFoundError();
  }

  return project;
}

async function findProjectScope(
  principalId: string,
  organizationSlug: string,
  projectName: string,
): Promise<ResolvedProjectScope | null> {
  const organization: OrganizationRow = await resolveRequiredOrganization(principalId, organizationSlug);
  const project: ProjectRow | undefined = await findProjectByOrganizationAndName(organization.id, projectName);
  if (project === undefined) {
    return null;
  }

  return {
    organization,
    project,
  };
}

export async function resolveRequiredOrganization(
  principalId: string,
  organizationSlug: string,
): Promise<OrganizationRow> {
  return (await resolveOrganizationForPrincipal(principalId, organizationSlug)) ?? failOrganizationLookup();
}

function failEnvironmentLookup(): never {
  throw createEnvironmentNotFoundError();
}

async function requireProjectScopePermission(
  principalId: string,
  projectScope: ResolvedProjectScope,
  permission: PermissionKey | undefined,
): Promise<void> {
  if (permission === undefined) {
    return;
  }

  await requireScopedPermission({
    organizationId: projectScope.organization.id,
    permission,
    principalId,
    routeScope: {
      scopeId: projectScope.project.id,
      scopeType: 'project',
    },
  });
}

async function requireExistingProjectScopePermission(
  principalId: string,
  organizationId: string,
  existingProject: ProjectRow | undefined,
  permission: PermissionKey | undefined,
): Promise<void> {
  if (existingProject === undefined || permission === undefined) {
    return;
  }

  await requireScopedPermission({
    organizationId,
    permission,
    principalId,
    routeScope: {
      scopeId: existingProject.id,
      scopeType: 'project',
    },
  });
}

async function requireProjectCreatePermission(
  principalId: string,
  organizationId: string,
  existingProject: ProjectRow | undefined,
  permission: PermissionKey | undefined,
): Promise<void> {
  if (existingProject !== undefined || permission === undefined) {
    return;
  }

  await requireScopedPermission({
    organizationId,
    permission,
    principalId,
    routeScope: {
      scopeId: organizationId,
      scopeType: 'organization',
    },
  });
}

function failMissingProjectService(): never {
  throw createServiceNotFoundError();
}

function failOrganizationLookup(): never {
  throw createOrganizationNotFoundError();
}
