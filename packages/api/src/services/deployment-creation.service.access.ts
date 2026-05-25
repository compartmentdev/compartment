import { type DeploymentRunTriggerType } from '@compartment/contracts';
import {
  createForbiddenError,
  createSourceUploadAlreadyConsumedError,
  createSourceUploadExpiredError,
  createSourceUploadNotFoundError,
} from '../errors/api-business-error';
import type { EnvironmentRow, ProjectServiceRow } from '../queries/deployments.query.types';
import { findSourceUploadByIdForOrganization } from '../queries/source-uploads.query';
import type { SourceUploadRow } from '../queries/source-uploads.query.types';
import {
  resolveExistingEnvironment,
  resolveRequiredProjectService,
  resolveActiveProjectScope,
} from './project-scope.service';
import type { ResolvedProjectScope } from './project-scope.service.types';
import type { DeployInputContext, DeploymentSourceProvenance } from './deployments.service.types';
import type { ConsumeSourceUploadContext } from './source-uploads.service.types';
import { requireEnvironmentPermission, requireProjectPermission } from './deployment-context.service.scope';
import {
  requireActiveHumanRuntimeActor,
  requireActiveSourceAutomationRuntimeActor,
} from './runtime-actor-authorization.service';

export async function assertDeploymentActorAccess(
  input: DeployInputContext,
  sourceUpload: Pick<SourceUploadRow, 'createdByPrincipalId'>,
): Promise<void> {
  if (input.sourceProvenance === undefined) {
    await requireActiveHumanRuntimeActor({
      organizationId: input.organizationId,
      principalId: input.actorPrincipalId,
    });
    return;
  }

  if (input.sourceProvenance.sourceAutomationPrincipalId !== input.actorPrincipalId) {
    throw createForbiddenError();
  }
  if (sourceUpload.createdByPrincipalId !== input.actorPrincipalId) {
    throw createForbiddenError();
  }

  await requireActiveSourceAutomationRuntimeActor({
    organizationId: input.organizationId,
    principalId: input.actorPrincipalId,
    sourceId: input.sourceProvenance.sourceId,
  });
}

export function resolveSourceUploadDeploymentRunTriggerType(
  sourceProvenance: DeploymentSourceProvenance | undefined,
): DeploymentRunTriggerType {
  return sourceProvenance === undefined ? 'manual' : 'autosync';
}

export async function assertSourceUploadMatchesDeployRequest(
  input: DeployInputContext,
  sourceUpload: SourceUploadRow,
  environmentName: string,
): Promise<void> {
  if (sourceUpload.projectId === null) {
    return;
  }

  const projectScope: ResolvedProjectScope = await resolveActiveProjectScope(
    input.actorPrincipalId,
    input.organizationSlug,
    input.descriptor.name,
  );
  if (projectScope.project.id !== sourceUpload.projectId) {
    throw createForbiddenError();
  }
  await assertSourceUploadEnvironmentScope(projectScope, sourceUpload, environmentName);
  await assertSourceUploadServiceScope(input, projectScope, sourceUpload);
  await requireSourceUploadScopeDeploymentPermission(input.actorPrincipalId, projectScope, sourceUpload);
}

export async function throwSourceUploadNoLongerDeployableError(input: ConsumeSourceUploadContext): Promise<never> {
  const sourceUpload: SourceUploadRow | undefined = await findSourceUploadByIdForOrganization(input);
  if (sourceUpload === undefined) {
    throw createSourceUploadNotFoundError();
  }
  if (sourceUpload.createdByPrincipalId !== input.actorPrincipalId) {
    throw createForbiddenError();
  }
  if (sourceUpload.consumedAt !== null) {
    throw createSourceUploadAlreadyConsumedError();
  }
  if (sourceUpload.expiresAt.getTime() <= Date.now()) {
    throw createSourceUploadExpiredError();
  }
  if (!doesSourceUploadMatchConsumptionTarget(input, sourceUpload)) {
    throw createForbiddenError();
  }

  throw createSourceUploadAlreadyConsumedError();
}

async function assertSourceUploadServiceScope(
  input: DeployInputContext,
  projectScope: ResolvedProjectScope,
  sourceUpload: Pick<SourceUploadRow, 'projectServiceId'>,
): Promise<void> {
  if (sourceUpload.projectServiceId === null) {
    return;
  }
  if (input.serviceName === undefined) {
    throw createForbiddenError();
  }
  const service: ProjectServiceRow = await resolveRequiredProjectService(projectScope.project.id, input.serviceName);
  if (service.id !== sourceUpload.projectServiceId) {
    throw createForbiddenError();
  }
}

async function assertSourceUploadEnvironmentScope(
  projectScope: ResolvedProjectScope,
  sourceUpload: Pick<SourceUploadRow, 'environmentId'>,
  environmentName: string,
): Promise<void> {
  if (sourceUpload.environmentId === null) {
    return;
  }
  const environment: EnvironmentRow = await resolveExistingEnvironment(projectScope.project.id, environmentName);
  if (environment.id !== sourceUpload.environmentId) {
    throw createForbiddenError();
  }
}

async function requireSourceUploadScopeDeploymentPermission(
  principalId: string,
  projectScope: ResolvedProjectScope,
  sourceUpload: Pick<SourceUploadRow, 'environmentId'>,
): Promise<void> {
  if (sourceUpload.environmentId !== null) {
    await requireEnvironmentPermission(
      principalId,
      projectScope.organization.id,
      sourceUpload.environmentId,
      'deployment.create',
    );
    return;
  }

  await requireProjectPermission(
    principalId,
    projectScope.organization.id,
    projectScope.project.id,
    'deployment.create',
  );
}

function doesSourceUploadMatchConsumptionTarget(
  input: ConsumeSourceUploadContext,
  sourceUpload: SourceUploadRow,
): boolean {
  return (
    doesOptionalScopeMatch(sourceUpload.projectId, input.projectId) &&
    doesOptionalScopeMatch(sourceUpload.environmentId, input.environmentId) &&
    doesOptionalServiceScopeMatch(sourceUpload.projectServiceId, input.projectServiceIds)
  );
}

function doesOptionalScopeMatch(scopeId: string | null, targetId: string | undefined): boolean {
  return scopeId === null || scopeId === targetId;
}

function doesOptionalServiceScopeMatch(scopeId: string | null, targetIds: readonly string[] | undefined): boolean {
  return scopeId === null || targetIds?.includes(scopeId) === true;
}
