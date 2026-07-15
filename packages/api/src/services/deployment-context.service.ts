import type { PermissionKey } from '@compartment/contracts';
import { createId } from '../lib/tokens';
import {
  createOrGetProjectService,
  listProjectServicesByProjectId,
  updateProjectService,
} from '../queries/deployment-context.query';
import type { EnvironmentRow, ProjectServiceRow } from '../queries/deployments.query.types';
import {
  findActiveProjectScope,
  resolveActiveProjectScope,
  resolveExistingEnvironment,
  resolveOrCreateActiveProjectScope,
  resolveRequiredProjectService,
} from './project-scope.service';
import type { ResolvedProjectScope } from './project-scope.service.types';
import type {
  ResolvedExistingBuildTargetContext,
  ResolvedDescriptorService,
  ResolvedEnvironmentContext,
  ResolvedProjectLookupContext,
  ResolvedProjectContext,
} from './deployments.service.types';
import {
  buildResolvedEnvironmentContext,
  buildResolvedProjectContext,
  requireEnvironmentPermission,
  requireProjectPermission,
  resolveWritableEnvironment,
  resolveWritableProjectScope,
} from './deployment-context.service.scope';
import { readEmptyBuildTargetContext, readExistingBuildTargetContext } from './deployment-context.service.helpers';

export {
  requireEnvironmentScopedDeployment,
  requireJoinedDeployment,
  requireProjectService,
  resolveDescriptorServices,
  resolveEnvironmentName,
} from './deployment-context.service.helpers';

export async function resolveProjectContext(
  principalId: string,
  organizationSlug: string,
  projectName: string,
  service: ResolvedDescriptorService,
  environmentName: string,
): Promise<ResolvedProjectContext> {
  const now: Date = new Date();
  const { environment, projectScope } = await resolveWritableProjectEnvironmentContext(
    principalId,
    organizationSlug,
    projectName,
    environmentName,
    now,
  );

  return buildResolvedProjectContext(
    projectScope,
    environment,
    await resolveOrCreateProjectService(projectScope.project.id, service, now),
    service,
  );
}

async function resolveWritableProjectEnvironmentContext(
  principalId: string,
  organizationSlug: string,
  projectName: string,
  environmentName: string,
  now: Date,
): Promise<{ environment: EnvironmentRow; projectScope: ResolvedProjectScope }> {
  const projectScope: ResolvedProjectScope = await resolveWritableProjectScope(
    principalId,
    organizationSlug,
    projectName,
    now,
  );
  const environment: EnvironmentRow = await resolveWritableEnvironment(
    principalId,
    projectScope,
    environmentName,
    now,
    'deployment.create',
  );

  return { environment, projectScope };
}

export async function resolveExistingProjectContext(
  principalId: string,
  organizationSlug: string,
  projectName: string,
  environmentName: string,
  serviceName: string,
  permission?: PermissionKey,
): Promise<ResolvedProjectContext> {
  const environmentContext: ResolvedEnvironmentContext = await resolveExistingEnvironmentContext(
    principalId,
    organizationSlug,
    projectName,
    environmentName,
    permission,
  );

  return {
    environment: environmentContext.environment,
    organization: environmentContext.organization,
    project: environmentContext.project,
    service: await resolveRequiredProjectService(environmentContext.project.id, serviceName),
  };
}

export async function resolveExistingBuildTargetContext(
  principalId: string,
  organizationSlug: string,
  projectName: string,
  environmentName: string,
  serviceName: string,
): Promise<ResolvedExistingBuildTargetContext> {
  const projectScope: ResolvedProjectScope | null = await findActiveProjectScope(
    principalId,
    organizationSlug,
    projectName,
  );
  if (projectScope === null) {
    return readEmptyBuildTargetContext();
  }

  return await readExistingBuildTargetContext(
    projectScope.organization.id,
    projectScope.project.id,
    environmentName,
    serviceName,
  );
}

export async function listProjectServices(projectId: string): Promise<ProjectServiceRow[]> {
  return await listProjectServicesByProjectId(projectId);
}

export async function resolveExistingProjectLookupContext(
  principalId: string,
  organizationSlug: string,
  projectName: string,
  permission?: PermissionKey,
): Promise<ResolvedProjectLookupContext> {
  const projectScope: ResolvedProjectScope = await resolveActiveProjectScope(
    principalId,
    organizationSlug,
    projectName,
  );
  if (permission !== undefined) {
    await requireProjectPermission(principalId, projectScope.organization.id, projectScope.project.id, permission);
  }

  return {
    organization: projectScope.organization,
    project: projectScope.project,
  };
}

export async function resolveExistingEnvironmentContext(
  principalId: string,
  organizationSlug: string,
  projectName: string,
  environmentName: string,
  permission?: PermissionKey,
): Promise<ResolvedEnvironmentContext> {
  const projectScope: ResolvedProjectScope = await resolveActiveProjectScope(
    principalId,
    organizationSlug,
    projectName,
  );
  const environment: EnvironmentRow = await resolveExistingEnvironment(projectScope.project.id, environmentName);
  if (permission !== undefined) {
    await requireEnvironmentPermission(principalId, projectScope.organization.id, environment.id, permission);
  }

  return {
    environment,
    organization: projectScope.organization,
    project: projectScope.project,
  };
}

export async function resolveOrCreateEnvironmentContext(
  principalId: string,
  organizationSlug: string,
  projectName: string,
  environmentName: string,
  permission?: PermissionKey,
): Promise<ResolvedEnvironmentContext> {
  const now: Date = new Date();
  const projectScope: ResolvedProjectScope = await resolveOrCreateActiveProjectScope(
    principalId,
    organizationSlug,
    projectName,
    now,
  );
  const environment: EnvironmentRow = await resolveWritableEnvironment(
    principalId,
    projectScope,
    environmentName,
    now,
    permission,
  );

  return buildResolvedEnvironmentContext(projectScope, environment);
}

async function resolveOrCreateProjectService(
  projectId: string,
  service: ResolvedDescriptorService,
  now: Date,
): Promise<ProjectServiceRow> {
  const projectService: ProjectServiceRow = await createOrGetProjectService({
    id: createId('svc'),
    kind: service.kind,
    name: service.name,
    path: service.path,
    projectId,
    updatedAt: now,
  });

  return await syncProjectService(projectService, service, now);
}

async function syncProjectService(
  projectService: ProjectServiceRow,
  service: ResolvedDescriptorService,
  now: Date,
): Promise<ProjectServiceRow> {
  if (projectService.kind === service.kind && projectService.path === service.path) {
    return projectService;
  }

  return await updateProjectService({
    kind: service.kind,
    path: service.path,
    projectServiceId: projectService.id,
    updatedAt: now,
  });
}
