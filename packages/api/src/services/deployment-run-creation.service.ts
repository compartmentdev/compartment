import type { DeploymentRunTriggerType } from '@compartment/contracts';
import { createId } from '../lib/tokens';
import { appendDeploymentRunEvent } from '../queries/deployment-run-events.query';
import { createDeploymentRun, deleteDeploymentRunById } from '../queries/deployment-runs.query';
import type { CreateDeploymentRunInput, DeploymentRunRow } from '../queries/deployment-runs.query.types';
import type { CreateDeploymentSourceProvenanceInput, DeploymentRow } from '../queries/deployments.query.types';

interface CreateDeploymentRunRecordInput extends CreateDeploymentSourceProvenanceInput {
  environmentId: string;
  label?: string | null | undefined;
  onboardingSessionId?: string | null | undefined;
  triggerType: DeploymentRunTriggerType;
  updatedAt: Date;
}

interface BuildCreateDeploymentRunRecordInput {
  environmentId: string;
  label?: string | null | undefined;
  onboardingSessionId?: string | null | undefined;
  sourceProvenance?: CreateDeploymentSourceProvenanceInput | undefined;
  triggerType: DeploymentRunTriggerType;
  updatedAt: Date;
}

export async function createDeploymentRunId(input: BuildCreateDeploymentRunRecordInput): Promise<string> {
  return (await createDeploymentRunRecord(buildCreateDeploymentRunRecordInput(input))).id;
}

async function createDeploymentRunRecord(input: CreateDeploymentRunRecordInput): Promise<DeploymentRunRow> {
  return await createDeploymentRun(buildCreateDeploymentRunInput(input));
}

function buildCreateDeploymentRunRecordInput(
  input: BuildCreateDeploymentRunRecordInput,
): CreateDeploymentRunRecordInput {
  return {
    environmentId: input.environmentId,
    label: input.label,
    onboardingSessionId: input.onboardingSessionId,
    ...(input.sourceProvenance ?? {}),
    triggerType: input.triggerType,
    updatedAt: input.updatedAt,
  };
}

export async function withDeploymentRunCleanupOnError<T>(
  deploymentRunId: string,
  action: () => Promise<T>,
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    await deleteDeploymentRunById(deploymentRunId).catch((): void => undefined);
    throw error;
  }
}

export async function appendQueuedDeploymentRunEvents(deployments: readonly DeploymentRow[]): Promise<void> {
  for (const deployment of deployments) {
    await appendDeploymentRunEvent({
      createdAt: deployment.createdAt,
      deploymentId: deployment.id,
      deploymentRunId: deployment.deploymentRunId,
      id: createId('drev'),
      level: 'info',
      message: 'deployment queued',
      status: 'running',
      stepKey: 'queued',
      stream: 'compartment',
    });
  }
}

function buildCreateDeploymentRunInput(input: CreateDeploymentRunRecordInput): CreateDeploymentRunInput {
  return {
    environmentId: input.environmentId,
    id: createId('drn'),
    label: input.label,
    onboardingSessionId: input.onboardingSessionId,
    sourceAutomationPrincipalId: input.sourceAutomationPrincipalId,
    sourceBindingId: input.sourceBindingId,
    sourceBindingSnapshotJson: input.sourceBindingSnapshotJson,
    sourceCommitSha: input.sourceCommitSha,
    sourceEventId: input.sourceEventId,
    sourceId: input.sourceId,
    sourceKind: input.sourceKind,
    sourceRepositorySnapshotJson: input.sourceRepositorySnapshotJson,
    sourceResolutionTaskId: input.sourceResolutionTaskId,
    triggerType: input.triggerType,
    updatedAt: input.updatedAt,
  };
}
