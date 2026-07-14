import type {
  WorkerClaimedGitSourceResolutionTask,
  WorkerCompleteGitSourceResolutionTaskRequest,
  WorkerFailGitSourceResolutionTaskRequest,
} from '@compartment/contracts';
import { createId } from '../../lib/tokens';
import { listDeploymentsBySourceResolutionTaskId } from '../../queries/deployments.query';
import type { DeploymentRow } from '../../queries/deployments.query.types';
import { findGitProviderRegistrationById } from '../../queries/git-provider-registration.query';
import type { GitProviderRegistrationRow } from '../../queries/git-provider-registration.query.types';
import { findOrganizationById } from '../../queries/organizations.query';
import type { OrganizationRow } from '../../queries/organizations.query.types';
import { findSourceBindingById, findSourceById, listBranchMappingsByBindingIds } from '../../queries/source.query';
import type { SourceBindingBranchMappingRow, SourceBindingRow, SourceRow } from '../../queries/source.query.types';
import {
  claimNextSourceResolutionTask,
  failSourceResolutionTask,
  findSourceResolutionTaskById,
  retrySourceResolutionTask,
} from '../../queries/source-resolution.query';
import type { SourceResolutionTaskRow } from '../../queries/source-resolution.query.types';
import { getApiDatabase } from '../../runtime/runtime-access';
import { createDeploymentsFromSourceUpload } from '../deployment-creation.service';
import type { DeploymentSummaryInput, DeployResponseInput } from '../presenter.types';
import { createSourceUploadFromArchivePath } from '../source-uploads.service';
import type { CreatedSourceUpload } from '../source-uploads.service.types';
import { getGitProviderAdapter } from './git-source-provider.registry';
import { ensureSourceAutomationPrincipal } from './git-source-automation-principal.service';
import {
  completeSourceEventIfTerminal,
  completeSourceResolutionTaskAndCleanup,
  finalizeSourceResolutionTaskDeployments,
  readBindingWatchPaths,
} from './git-source-resolution-worker.finalization';
import {
  deleteSourceResolutionTaskArchive,
  resolveSourceResolutionTaskArchivePath,
} from './source-resolution-task-archive-storage.service';
import {
  buildClaimedTaskProviderFields,
  isSourceResolutionTaskStillDeployable,
  requireActiveBinding,
  requireActiveSource,
  requireGitProviderRegistration,
  requireOrganization,
  requireSourceResolutionTask,
  serializeSourceBindingSnapshot,
  serializeSourceRepositorySnapshot,
} from './git-source-resolution-worker.support';
import type { DeploymentSourceProvenance } from '../deployments.service.types';

const sourceResolutionTaskLeaseMs: number = 5 * 60 * 1000;

interface DeployableSourceResolutionTaskState {
  binding: SourceBindingRow;
  organization: OrganizationRow;
  source: SourceRow;
}

export async function claimGitSourceResolutionTaskForWorker(): Promise<WorkerClaimedGitSourceResolutionTask | null> {
  const now: Date = new Date();
  const claimed: SourceResolutionTaskRow | null = await claimNextSourceResolutionTask(
    createId('wrk'),
    now,
    new Date(now.getTime() + sourceResolutionTaskLeaseMs),
  );
  return claimed === null ? null : await buildClaimedSourceResolutionTask(claimed);
}

export async function completeGitSourceResolutionTaskForWorker(
  input: WorkerCompleteGitSourceResolutionTaskRequest,
): Promise<void> {
  const task: SourceResolutionTaskRow = requireSourceResolutionTask(await findSourceResolutionTaskById(input.taskId));
  if (task.status === 'completed' || task.status === 'failed' || task.status === 'canceled') {
    return;
  }

  const existingDeployments: DeploymentRow[] = await listDeploymentsBySourceResolutionTaskId(task.id);
  if (existingDeployments.length > 0) {
    await finalizeSourceResolutionTaskDeployments(task, existingDeployments);
    return;
  }

  await completeFreshSourceResolutionTask(task, input);
}

export async function failGitSourceResolutionTaskForWorker(
  input: WorkerFailGitSourceResolutionTaskRequest,
): Promise<void> {
  const task: SourceResolutionTaskRow = requireSourceResolutionTask(await findSourceResolutionTaskById(input.taskId));
  if (task.status === 'completed' || task.status === 'failed' || task.status === 'canceled') {
    return;
  }
  await deleteSourceResolutionTaskArchive(task.id);

  if (!input.retryable || task.attemptCount >= task.maxAttempts) {
    await failClaimedSourceResolutionTask(task, input.failureReason);
    return;
  }

  await retrySourceResolutionTask(getApiDatabase(), {
    failureReason: input.failureReason,
    id: task.id,
    updatedAt: new Date(),
  });
}

async function buildClaimedSourceResolutionTask(
  claimed: SourceResolutionTaskRow,
): Promise<WorkerClaimedGitSourceResolutionTask> {
  const source: SourceRow = requireActiveSource(await findSourceById(claimed.sourceId));
  const binding: SourceBindingRow = requireActiveBinding(await findSourceBindingById(claimed.sourceBindingId));
  const registration: GitProviderRegistrationRow = await readSourceGitProviderRegistration(source);
  return {
    ...buildClaimedTaskProviderFields(registration, source),
    branchName: claimed.branchName,
    commitSha: claimed.commitSha,
    descriptorPath: binding.descriptorPath,
    providerAccessToken: await mintResolutionRuntimeAccessToken(source, registration),
    projectName: binding.projectName,
    providerHost: source.providerHost,
    repositoryName: source.repositoryName,
    repositoryOwner: source.repositoryOwner,
    sourceBindingId: binding.id,
    sourceEventId: claimed.sourceEventId,
    sourceId: source.id,
    targetEnvironmentName: claimed.targetEnvironmentName,
    taskId: claimed.id,
  };
}

async function mintResolutionRuntimeAccessToken(
  source: SourceRow,
  registration: GitProviderRegistrationRow,
): Promise<string> {
  return await getGitProviderAdapter(registration.providerType).mintRuntimeAccessToken({ registration, source });
}

async function readSourceGitProviderRegistration(source: SourceRow): Promise<GitProviderRegistrationRow> {
  return requireGitProviderRegistration(
    await findGitProviderRegistrationById({
      organizationId: source.organizationId,
      registrationId: source.providerRegistrationId,
    }),
  );
}

async function completeFreshSourceResolutionTask(
  task: SourceResolutionTaskRow,
  input: WorkerCompleteGitSourceResolutionTaskRequest,
): Promise<void> {
  const deployableState: DeployableSourceResolutionTaskState | null =
    await readDeployableSourceResolutionTaskState(task);
  if (deployableState === null) {
    await completeSourceResolutionTaskAndCleanup(task);
    return;
  }

  const deployments: DeploymentRow[] = await createSourceDrivenDeployments(deployableState, task, input);
  await finalizeSourceResolutionTaskDeployments(task, deployments);
}

async function createSourceDrivenDeployments(
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
  const deploymentInput: DeployResponseInput = await createDeploymentsFromSourceUpload({
    actorPrincipalId: automationPrincipalId,
    descriptor: input.descriptor,
    environmentName: task.targetEnvironmentName,
    organizationId: state.organization.id,
    organizationSlug: state.organization.slug,
    routes: input.routes,
    sourceProvenance: buildSourceProvenance(state, task, automationPrincipalId),
    sourceUploadId: sourceUpload.id,
  });

  return deploymentInput.deployments.map((deployment: DeploymentSummaryInput): DeploymentRow => deployment.deployment);
}

async function readDeployableSourceResolutionTaskState(
  task: SourceResolutionTaskRow,
): Promise<DeployableSourceResolutionTaskState | null> {
  const source: SourceRow | undefined = await findSourceById(task.sourceId);
  if (source?.status !== 'active') {
    return null;
  }

  const binding: SourceBindingRow | undefined = await findSourceBindingById(task.sourceBindingId);
  if (binding?.status !== 'active') {
    return null;
  }

  const branchMappings: SourceBindingBranchMappingRow[] = await listBranchMappingsByBindingIds([binding.id]);
  if (!isSourceResolutionTaskStillDeployable(binding, branchMappings, task)) {
    return null;
  }

  return {
    binding,
    organization: requireOrganization(await findOrganizationById(source.organizationId)),
    source,
  };
}

async function failClaimedSourceResolutionTask(task: SourceResolutionTaskRow, failureReason: string): Promise<void> {
  const now: Date = new Date();
  await failSourceResolutionTask(getApiDatabase(), {
    completedAt: now,
    failureReason,
    id: task.id,
    updatedAt: now,
  });
  await completeSourceEventIfTerminal(task.sourceEventId, now);
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
