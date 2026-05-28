import { createProjectArchivedError, createProjectNotFoundError } from '../errors/api-business-error';
import { consumeSourceUploadAndCreateQueuedDeploymentBatch } from '../queries/deployment-batch.query';
import type { QueuedDeploymentBatchResult } from '../queries/deployment-batch.query.types';
import type {
  ConsumeSourceUploadAndCreateQueuedDeploymentBatchInput,
  CreateQueuedDeploymentBatchItem,
  DeploymentRow,
} from '../queries/deployments.query.types';
import type { SourceUploadConsumptionScopeInput, SourceUploadRow } from '../queries/source-uploads.query.types';
import type { DeployInputContext, ResolvedProjectContext } from './deployments.service.types';
import {
  assertDeploymentActorAccess,
  assertSourceUploadMatchesDeployRequest,
  throwSourceUploadNoLongerDeployableError,
} from './deployment-creation.service.access';
import { buildQueuedDeploymentBatchItem } from './deployment-creation.service.helpers';
import type { PreparedQueuedDeploymentState } from './deployment-creation.service.types';
import { requireDeployableSourceUpload } from './source-uploads.service';

export async function requireAuthorizedSubmitSourceUpload(
  input: DeployInputContext,
  environmentName: string,
): Promise<SourceUploadRow> {
  const sourceUpload: SourceUploadRow = await requireDeployableSubmitSourceUpload(input);
  await assertDeploymentActorAccess(input, sourceUpload);
  await assertSourceUploadMatchesDeployRequest(input, sourceUpload, environmentName);

  return sourceUpload;
}

export function buildSourceUploadConsumptionScope(
  input: DeployInputContext,
  contexts: readonly ResolvedProjectContext[],
  sourceUpload: SourceUploadRow,
): SourceUploadConsumptionScopeInput {
  return {
    actorPrincipalId: input.actorPrincipalId,
    environmentId: contexts[0]!.environment.id,
    organizationId: input.organizationId,
    projectId: contexts[0]!.project.id,
    projectServiceIds: contexts.map((context: ResolvedProjectContext): string => context.service.id),
    sourceUploadId: sourceUpload.id,
  };
}

export async function queuePreparedDeployments(
  preparedStates: readonly PreparedQueuedDeploymentState[],
  sourceUploadScope: SourceUploadConsumptionScopeInput,
  label: string | undefined,
): Promise<DeploymentRow[]> {
  const consumedAt: Date = new Date();
  const queuedDeployments: QueuedDeploymentBatchResult = await consumeSourceUploadAndCreateQueuedDeploymentBatch(
    buildQueuedDeploymentBatchInput(preparedStates, sourceUploadScope, label, consumedAt),
  );
  if (queuedDeployments === undefined) {
    return await throwSourceUploadNoLongerDeployableError(sourceUploadScope);
  }
  if (queuedDeployments === 'project_archived') {
    throw createProjectArchivedError();
  }
  if (queuedDeployments === 'project_not_found') {
    throw createProjectNotFoundError();
  }

  return queuedDeployments;
}

async function requireDeployableSubmitSourceUpload(input: DeployInputContext): Promise<SourceUploadRow> {
  return await requireDeployableSourceUpload({
    actorPrincipalId: input.actorPrincipalId,
    organizationId: input.organizationId,
    sourceUploadId: input.sourceUploadId,
  });
}

function buildQueuedDeploymentBatchInput(
  preparedStates: readonly PreparedQueuedDeploymentState[],
  sourceUploadScope: SourceUploadConsumptionScopeInput,
  label: string | undefined,
  consumedAt: Date,
): ConsumeSourceUploadAndCreateQueuedDeploymentBatchInput {
  return {
    actorPrincipalId: sourceUploadScope.actorPrincipalId,
    consumedAt,
    environmentId: sourceUploadScope.environmentId,
    expiresAtCutoff: consumedAt,
    items: preparedStates.map(
      (state: PreparedQueuedDeploymentState): CreateQueuedDeploymentBatchItem =>
        buildQueuedDeploymentBatchItem(state, sourceUploadScope.actorPrincipalId, label),
    ),
    organizationId: sourceUploadScope.organizationId,
    projectId: sourceUploadScope.projectId,
    projectServiceIds: sourceUploadScope.projectServiceIds,
    sourceUploadId: sourceUploadScope.sourceUploadId,
  };
}
