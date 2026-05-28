import type { WorkerCompleteGitSourceResolutionTaskRequest } from '@compartment/contracts';
import type { DeploymentProjectMutationRejection } from '../../queries/deployment-project-mutation.query.types';
import type { DeploymentRow } from '../../queries/deployments.query.types';
import type { SourceResolutionTaskRow } from '../../queries/source-resolution.query.types';
import { createDeploymentsFromSourceUpload } from '../deployment-creation.service';
import { isDeploymentProjectMutationRejection } from '../deployment-project-mutation-result.service';
import type { DeployInputContext, DeploymentSourceProvenance } from '../deployments.service.types';
import type { DeploymentSummaryInput, DeployResponseInput } from '../presenter.types';
import { cleanupConsumedSourceUpload, createSourceUploadFromArchivePath } from '../source-uploads.service';
import type { CreatedSourceUpload } from '../source-uploads.service.types';
import { ensureSourceAutomationPrincipal } from './git-source-automation-principal.service';
import { readBindingWatchPaths } from './git-source-resolution-worker.finalization';
import type { DeployableSourceResolutionTaskState } from './git-source-resolution-worker.types';
import {
  serializeSourceBindingSnapshot,
  serializeSourceRepositorySnapshot,
} from './git-source-resolution-worker.support';
import { resolveSourceResolutionTaskArchivePath } from './source-resolution-task-archive-storage.service';

export async function createSourceDrivenDeployments(
  state: DeployableSourceResolutionTaskState,
  task: SourceResolutionTaskRow,
  input: WorkerCompleteGitSourceResolutionTaskRequest,
): Promise<DeploymentRow[]> {
  const automationPrincipalId: string = await ensureSourceAutomationPrincipal(state.source);
  const sourceUpload: CreatedSourceUpload = await createSourceUploadFromArchivePath({
    actorPrincipalId: automationPrincipalId,
    archivePath: resolveSourceResolutionTaskArchivePath(task.id),
    organizationId: state.source.organizationId,
    sourceId: state.source.id,
  });
  try {
    return await createDeploymentsFromResolvedSourceUpload(state, task, input, automationPrincipalId, sourceUpload);
  } catch (error) {
    await cleanupSourceUploadBestEffort(sourceUpload.id);
    throw error;
  }
}

async function createDeploymentsFromResolvedSourceUpload(
  state: DeployableSourceResolutionTaskState,
  task: SourceResolutionTaskRow,
  input: WorkerCompleteGitSourceResolutionTaskRequest,
  automationPrincipalId: string,
  sourceUpload: CreatedSourceUpload,
): Promise<DeploymentRow[]> {
  const deploymentInput: DeployResponseInput | DeploymentProjectMutationRejection =
    await createDeploymentsFromSourceUpload(
      buildSourceDrivenDeploymentInput(state, task, input, automationPrincipalId, sourceUpload.id),
    );
  if (isDeploymentProjectMutationRejection(deploymentInput)) {
    await cleanupSourceUploadBestEffort(sourceUpload.id);
    return [];
  }

  return deploymentInput.deployments.map((deployment: DeploymentSummaryInput): DeploymentRow => deployment.deployment);
}

async function cleanupSourceUploadBestEffort(sourceUploadId: string): Promise<void> {
  await cleanupConsumedSourceUpload(sourceUploadId).catch((): void => undefined);
}

function buildSourceDrivenDeploymentInput(
  state: DeployableSourceResolutionTaskState,
  task: SourceResolutionTaskRow,
  input: WorkerCompleteGitSourceResolutionTaskRequest,
  actorPrincipalId: string,
  sourceUploadId: string,
): DeployInputContext {
  return {
    actorPrincipalId,
    descriptor: input.descriptor,
    environmentName: task.targetEnvironmentName,
    organizationId: state.organization.id,
    organizationSlug: state.organization.slug,
    routes: input.routes,
    sourceProvenance: buildSourceProvenance(state, task, actorPrincipalId),
    sourceUploadId,
  };
}

function buildSourceProvenance(
  state: DeployableSourceResolutionTaskState,
  task: SourceResolutionTaskRow,
  automationPrincipalId: string,
): DeploymentSourceProvenance {
  return {
    sourceAutomationPrincipalId: automationPrincipalId,
    sourceBindingId: state.binding.id,
    sourceBindingSnapshotJson: serializeSourceBindingSnapshot(
      state.binding,
      task,
      readBindingWatchPaths(state.binding),
    ),
    sourceCommitSha: task.commitSha,
    sourceEventId: task.sourceEventId,
    sourceId: state.source.id,
    sourceKind: state.source.type,
    sourceRepositorySnapshotJson: serializeSourceRepositorySnapshot(state.source, task),
    sourceResolutionTaskId: task.id,
  };
}
