import type { PermissionKey } from '@compartment/contracts';
import { findEnvironmentByProjectAndName } from '../queries/deployment-context.query';
import type { EnvironmentRow, ProjectServiceRow } from '../queries/deployments.query.types';
import { requireScopedPermission } from './access-scope.service';
import type {
  ResolvedDescriptorService,
  ResolvedEnvironmentContext,
  ResolvedProjectContext,
} from './deployments.service.types';
import { resolveOrCreateActiveProjectScope, resolveOrCreateEnvironment } from './project-scope.service';
import type { ResolvedProjectScope } from './project-scope.service.types';

export function buildResolvedProjectContext(
  projectScope: ResolvedProjectScope,
  environment: EnvironmentRow,
  service: ProjectServiceRow,
  descriptorService?: ResolvedDescriptorService,
): ResolvedProjectContext {
  return {
    descriptorService,
    environment,
    organization: projectScope.organization,
    project: projectScope.project,
    service,
  };
}

export function buildResolvedEnvironmentContext(
  projectScope: ResolvedProjectScope,
  environment: EnvironmentRow,
): ResolvedEnvironmentContext {
  return {
    environment,
    organization: projectScope.organization,
    project: projectScope.project,
  };
}

export async function resolveWritableProjectScope(
  principalId: string,
  organizationSlug: string,
  projectName: string,
  now: Date,
): Promise<ResolvedProjectScope> {
  return await resolveOrCreateActiveProjectScope(principalId, organizationSlug, projectName, now, {
    createPermission: 'organization.project.create',
  });
}

export async function resolveWritableEnvironment(
  principalId: string,
  projectScope: ResolvedProjectScope,
  environmentName: string,
  now: Date,
  permission: PermissionKey | undefined,
): Promise<EnvironmentRow> {
  return await resolveOrCreateAuthorizedEnvironment(
    principalId,
    projectScope.organization.id,
    projectScope.project.id,
    environmentName,
    now,
    permission,
  );
}

async function resolveOrCreateAuthorizedEnvironment(
  principalId: string,
  organizationId: string,
  projectId: string,
  environmentName: string,
  now: Date,
  permission: PermissionKey | undefined,
): Promise<EnvironmentRow> {
  const existingEnvironment: EnvironmentRow | undefined = await findEnvironmentByProjectAndName(
    projectId,
    environmentName,
  );
  if (existingEnvironment !== undefined) {
    if (permission !== undefined) {
      await requireEnvironmentPermission(principalId, organizationId, existingEnvironment.id, permission);
    }

    return existingEnvironment;
  }
  if (permission !== undefined) {
    await requireProjectPermission(principalId, organizationId, projectId, permission);
  }

  return await resolveOrCreateEnvironment(projectId, environmentName, now);
}

export async function requireEnvironmentPermission(
  principalId: string,
  organizationId: string,
  environmentId: string,
  permission: PermissionKey,
): Promise<void> {
  await requireScopedPermission({
    organizationId,
    permission,
    principalId,
    routeScope: {
      scopeId: environmentId,
      scopeType: 'environment',
    },
  });
}

export async function requireProjectPermission(
  principalId: string,
  organizationId: string,
  projectId: string,
  permission: PermissionKey,
): Promise<void> {
  await requireScopedPermission({
    organizationId,
    permission,
    principalId,
    routeScope: {
      scopeId: projectId,
      scopeType: 'project',
    },
  });
}
