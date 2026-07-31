import type {
  WorkerClaimedGitSourceResolutionTask,
  WorkerCompleteGitSourceResolutionTaskRequest,
  WorkerFailGitSourceResolutionTaskRequest,
} from '@compartment/contracts';
import { decryptVariableValueFromStorage } from '../../lib/variables-crypto';
import { createId } from '../../lib/tokens';
import { listDeploymentsBySourceResolutionTaskId } from '../../queries/deployments.query';
import type { DeploymentRow } from '../../queries/deployments.query.types';
import { findGitProviderRegistrationById } from '../../queries/git-provider-registration.query';
import type { GitProviderRegistrationRow } from '../../queries/git-provider-registration.query.types';
import { findOrganizationById } from '../../queries/organizations.query';
import { findSourceBindingById, findSourceById, listBranchMappingsByBindingIds } from '../../queries/source.query';
import type { SourceBindingBranchMappingRow, SourceBindingRow, SourceRow } from '../../queries/source.query.types';
import {
  claimNextSourceResolutionTask,
  failSourceResolutionTask,
  findSourceResolutionTaskById,
  retrySourceResolutionTask,
} from '../../queries/source-resolution.query';
import type { SourceResolutionTaskRow } from '../../queries/source-resolution.query.types';
import { getApiConfig, getApiDatabase } from '../../runtime/runtime-access';
import { mintGitHubInstallationToken } from './github-app-http.adapter';
import { createSourceDrivenDeployments } from './git-source-resolution-deployment.service';
import {
  completeSourceEventIfTerminal,
  completeSourceResolutionTaskAndCleanup,
  finalizeSourceResolutionTaskDeployments,
} from './git-source-resolution-worker.finalization';
import { deleteSourceResolutionTaskArchive } from './source-resolution-task-archive-storage.service';
import {
  isSourceResolutionTaskStillDeployable,
  requireActiveBinding,
  requireActiveSource,
  requireEncryptedRegistrationField,
  requireGitProviderRegistration,
  requireOrganization,
  requireSourceResolutionTask,
} from './git-source-resolution-worker.support';
import type { DeployableSourceResolutionTaskState } from './git-source-resolution-worker.types';

const sourceResolutionTaskLeaseMs: number = 5 * 60 * 1000;

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
    branchName: claimed.branchName,
    commitSha: claimed.commitSha,
    descriptorPath: binding.descriptorPath,
    installationToken: await mintSourceInstallationToken(source, registration),
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

async function mintSourceInstallationToken(
  source: SourceRow,
  registration: GitProviderRegistrationRow,
): Promise<string> {
  return await mintGitHubInstallationToken({
    appId: requireEncryptedRegistrationField(registration.appId, 'app_id'),
    installationId: source.providerInstallationId,
    privateKeyPem: decryptVariableValueFromStorage(
      requireEncryptedRegistrationField(registration.privateKeyPemCiphertext, 'private_key_pem_ciphertext'),
      requireEncryptedRegistrationField(registration.privateKeyPemEncryptionKeyId, 'private_key_pem_encryption_key_id'),
      getApiConfig().variablesMasterKey,
    ),
    providerHost: source.providerHost,
  });
}
