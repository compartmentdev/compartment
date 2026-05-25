import type { PermissionKey } from '@compartment/contracts';
import type { EnvironmentRow, ProjectServiceRow } from '../queries/deployments.query.types';
import { createInvalidVariableTargetError, createServiceNotFoundError } from '../errors/api-business-error';
import { findEnvironmentByProjectAndName, findProjectServiceByName } from '../queries/deployment-context.query';
import {
  findActiveProjectScope,
  resolveActiveProjectScope,
  resolveExistingEnvironment,
  resolveOrCreateEnvironment,
  resolveOrCreateActiveProjectScope,
  resolveRequiredProjectService,
} from './project-scope.service';
import type { ResolvedProjectScope } from './project-scope.service.types';
import { requireScopedPermission } from './access-scope.service';
import { failMissingServiceName, readEnvironmentName } from './variables.service.helpers';
import type { VariableTargetContext, VariableTargetInput } from './variables.service.types';

interface VariableWriteInput extends VariableTargetInput {
  fromResource?: string | undefined;
}

interface VariableWriteProjectEnvironmentTarget {
  environment: EnvironmentRow;
  projectScope: ResolvedProjectScope;
}

type VariableTargetServiceResolution = 'optional' | 'required';

export async function resolveReadVariableTarget(
  input: VariableTargetInput,
  permission: PermissionKey,
): Promise<VariableTargetContext> {
  return await resolveExistingVariableTarget(input, permission, 'required');
}

export async function resolveRemoveVariableTarget(
  input: VariableTargetInput,
  permission: PermissionKey,
): Promise<VariableTargetContext> {
  return await resolveExistingVariableTarget(input, permission, 'optional');
}

async function resolveExistingVariableTarget(
  input: VariableTargetInput,
  permission: PermissionKey,
  serviceResolution: VariableTargetServiceResolution,
): Promise<VariableTargetContext> {
  assertVariableTargetInput(input);
  const projectScope: ResolvedProjectScope = await resolveVariableProjectScope(input);
  const environment: EnvironmentRow = await resolveExistingEnvironment(
    projectScope.project.id,
    readEnvironmentName(input),
  );
  await requireEnvironmentPermission(input.principalId, projectScope.organization.id, environment.id, permission);
  const service: ProjectServiceRow | null = await readVariableTargetService(
    projectScope.project.id,
    input.serviceName,
    serviceResolution,
  );

  return buildVariableTargetContext(
    projectScope,
    environment,
    service,
    input.resourceName ?? null,
    input.serviceName ?? null,
  );
}

export async function resolveWriteVariableTarget(
  input: VariableWriteInput,
  now: Date,
  permission: PermissionKey,
): Promise<VariableTargetContext> {
  assertVariableTargetInput(input);
  if (input.resourceName !== undefined) {
    return await resolveResourceWriteVariableTarget(input, now, permission);
  }
  if (input.serviceName !== undefined) {
    return await resolveServiceWriteVariableTarget(input, now, permission);
  }

  return await resolveEnvironmentWriteVariableTarget(input, now, permission);
}

async function resolveResourceWriteVariableTarget(
  input: VariableWriteInput,
  now: Date,
  permission: PermissionKey,
): Promise<VariableTargetContext> {
  const target: VariableWriteProjectEnvironmentTarget = await resolveProjectEnvironmentWriteTarget(
    input,
    now,
    permission,
  );

  return buildVariableTargetContext(target.projectScope, target.environment, null, input.resourceName ?? null, null);
}

async function resolveEnvironmentWriteVariableTarget(
  input: VariableWriteInput,
  now: Date,
  permission: PermissionKey,
): Promise<VariableTargetContext> {
  const target: VariableWriteProjectEnvironmentTarget = await resolveProjectEnvironmentWriteTarget(
    input,
    now,
    permission,
  );

  return buildVariableTargetContext(target.projectScope, target.environment, null, null, null);
}

async function resolveServiceWriteVariableTarget(
  input: VariableWriteInput,
  now: Date,
  permission: PermissionKey,
): Promise<VariableTargetContext> {
  const serviceName: string = input.serviceName ?? failMissingServiceName();
  const projectScope: ResolvedProjectScope = await resolveServiceWriteProjectScope(input, now, permission);
  const service: ProjectServiceRow | null =
    input.fromResource === undefined
      ? await resolveRequiredProjectService(projectScope.project.id, serviceName)
      : await readVariableTargetService(projectScope.project.id, serviceName, 'optional');
  const environment: EnvironmentRow = await resolveOrCreateAuthorizedEnvironment(
    input.principalId,
    projectScope.organization.id,
    projectScope.project.id,
    readEnvironmentName(input),
    now,
    permission,
  );

  return buildVariableTargetContext(projectScope, environment, service, null, serviceName);
}

async function resolveServiceWriteProjectScope(
  input: VariableWriteInput,
  now: Date,
  permission: PermissionKey,
): Promise<ResolvedProjectScope> {
  const projectScope: ResolvedProjectScope | null = await findVariableProjectScope(input);
  if (projectScope !== null) {
    return projectScope;
  }
  if (input.fromResource === undefined) {
    throw createServiceNotFoundError();
  }

  return await resolveOrCreateActiveProjectScope(input.principalId, input.organizationSlug, input.projectName, now, {
    createPermission: 'project.lifecycle.write',
    permission,
  });
}

async function resolveProjectEnvironmentWriteTarget(
  input: VariableWriteInput,
  now: Date,
  permission: PermissionKey,
): Promise<VariableWriteProjectEnvironmentTarget> {
  const projectScope: ResolvedProjectScope =
    (await findVariableProjectScope(input)) ??
    (await resolveOrCreateActiveProjectScope(input.principalId, input.organizationSlug, input.projectName, now, {
      createPermission: 'project.lifecycle.write',
      permission,
    }));
  const environment: EnvironmentRow = await resolveOrCreateAuthorizedEnvironment(
    input.principalId,
    projectScope.organization.id,
    projectScope.project.id,
    readEnvironmentName(input),
    now,
    permission,
  );

  return { environment, projectScope };
}

async function resolveOrCreateAuthorizedEnvironment(
  principalId: string,
  organizationId: string,
  projectId: string,
  environmentName: string,
  now: Date,
  permission: PermissionKey,
): Promise<EnvironmentRow> {
  const existingEnvironment: EnvironmentRow | undefined = await findEnvironmentByProjectAndName(
    projectId,
    environmentName,
  );
  if (existingEnvironment !== undefined) {
    await requireEnvironmentPermission(principalId, organizationId, existingEnvironment.id, permission);
    return existingEnvironment;
  }

  await requireProjectPermission(principalId, organizationId, projectId, permission);
  return await resolveOrCreateEnvironment(projectId, environmentName, now);
}

async function requireEnvironmentPermission(
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

async function requireProjectPermission(
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

async function findVariableProjectScope(input: VariableTargetInput): Promise<ResolvedProjectScope | null> {
  return await findActiveProjectScope(input.principalId, input.organizationSlug, input.projectName);
}

async function resolveVariableProjectScope(input: VariableTargetInput): Promise<ResolvedProjectScope> {
  return await resolveActiveProjectScope(input.principalId, input.organizationSlug, input.projectName);
}

async function readVariableTargetService(
  projectId: string,
  serviceName: string | undefined,
  serviceResolution: VariableTargetServiceResolution,
): Promise<ProjectServiceRow | null> {
  if (serviceName === undefined) {
    return null;
  }

  if (serviceResolution === 'required') {
    return await resolveRequiredProjectService(projectId, serviceName);
  }

  return (await findProjectServiceByName(projectId, serviceName)) ?? null;
}

function buildVariableTargetContext(
  projectScope: ResolvedProjectScope,
  environment: EnvironmentRow,
  service: ProjectServiceRow | null,
  resourceName: string | null,
  serviceName: string | null,
): VariableTargetContext {
  return {
    environment,
    organization: projectScope.organization,
    project: projectScope.project,
    resourceName,
    service,
    serviceName,
  };
}

function assertVariableTargetInput(input: VariableTargetInput): void {
  if (input.resourceName !== undefined && input.serviceName !== undefined) {
    throw createInvalidVariableTargetError('Select either serviceName or resourceName, not both.');
  }
}
