import type { EnvironmentRow, ProjectServiceRow } from '../queries/deployments.query.types';
import { findEnvironmentByProjectAndName } from '../queries/deployment-context.query';
import { requireScopedPermission } from './access-scope.service';
import { requireEnvironmentPermission, requireProjectPermission } from './deployment-context.service.scope';
import { resolveOrCreateActiveProjectScope, resolveRequiredProjectService } from './project-scope.service';
import type { ResolvedProjectScope } from './project-scope.service.types';
import type { ResolveSourceUploadScopeInput, SourceUploadScope } from './source-uploads.service.types';

export async function resolveSourceUploadScope(input: ResolveSourceUploadScopeInput): Promise<SourceUploadScope> {
  if (input.query.projectName === undefined) {
    await requireOrganizationSourceUploadPermission(input);
    return readUnscopedSourceUploadScope();
  }

  const now: Date = new Date();
  const projectScope: ResolvedProjectScope = await resolveSourceUploadProjectScope(input, now);
  const environment: EnvironmentRow | null = await resolveSourceUploadEnvironment(input, projectScope.project.id);
  await requireScopedSourceUploadPermission(input, projectScope, environment);
  const service: ProjectServiceRow | null = await resolveSourceUploadProjectService(input, projectScope.project.id);

  return {
    environmentId: environment?.id ?? null,
    projectId: projectScope.project.id,
    projectServiceId: service?.id ?? null,
  };
}

export function readUnscopedSourceUploadScope(): SourceUploadScope {
  return {
    environmentId: null,
    projectId: null,
    projectServiceId: null,
  };
}

async function resolveSourceUploadProjectScope(
  input: ResolveSourceUploadScopeInput,
  now: Date,
): Promise<ResolvedProjectScope> {
  if (input.query.projectName === undefined) {
    throw new Error('Expected source upload project name.');
  }

  return await resolveOrCreateActiveProjectScope(
    input.actorPrincipalId,
    input.organizationSlug,
    input.query.projectName,
    now,
    {
      createPermission: 'organization.project.create',
    },
  );
}

async function resolveSourceUploadEnvironment(
  input: ResolveSourceUploadScopeInput,
  projectId: string,
): Promise<EnvironmentRow | null> {
  return input.query.environmentName === undefined
    ? null
    : ((await findEnvironmentByProjectAndName(projectId, input.query.environmentName)) ?? null);
}

async function resolveSourceUploadProjectService(
  input: ResolveSourceUploadScopeInput,
  projectId: string,
): Promise<ProjectServiceRow | null> {
  return input.query.serviceName === undefined
    ? null
    : await resolveRequiredProjectService(projectId, input.query.serviceName);
}

async function requireOrganizationSourceUploadPermission(input: ResolveSourceUploadScopeInput): Promise<void> {
  await requireScopedPermission({
    organizationId: input.organizationId,
    permission: 'deployment.create',
    principalId: input.actorPrincipalId,
    routeScope: {
      scopeId: input.organizationId,
      scopeType: 'organization',
    },
  });
}

async function requireScopedSourceUploadPermission(
  input: ResolveSourceUploadScopeInput,
  projectScope: ResolvedProjectScope,
  environment: EnvironmentRow | null,
): Promise<void> {
  if (environment !== null) {
    await requireEnvironmentPermission(
      input.actorPrincipalId,
      projectScope.organization.id,
      environment.id,
      'deployment.create',
    );
    return;
  }

  await requireProjectPermission(
    input.actorPrincipalId,
    projectScope.organization.id,
    projectScope.project.id,
    'deployment.create',
  );
}
