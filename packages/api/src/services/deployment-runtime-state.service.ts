import {
  readWorkerUpstreamTargetPresence,
  type RuntimeDrainState,
  type WorkerAppendDeploymentEventRequest,
  type WorkerUpstreamTargetPresence,
  type WorkerUpdateDeploymentRuntimeRequest,
  workerUpstreamTargetValidationMessage,
} from '@compartment/contracts';
import { createDeploymentNotFoundError } from '../errors/api-business-error';
import { createId } from '../lib/tokens';
import { appendDeploymentRunEvent } from '../queries/deployment-run-events.query';
import { findDeploymentRunDeployment, updateDeploymentRuntimeStateIfExists } from '../queries/deployments.query';
import type { DeploymentRow } from '../queries/deployments.query.types';

interface DeploymentDrainStateUpdate {
  drainDeadlineAt?: Date | null | undefined;
  drainingContainerId?: string | null | undefined;
  drainingDeploymentId?: string | null | undefined;
  drainingNodeId?: string | null | undefined;
}

interface DeploymentUpstreamStateUpdate {
  upstreamHost?: string | null | undefined;
  upstreamPort?: number | null | undefined;
}

export async function updateDeploymentRuntimeStateForWorker(
  input: WorkerUpdateDeploymentRuntimeRequest,
): Promise<void> {
  const deployment: DeploymentRow | undefined = await updateDeploymentRuntimeStateIfExists({
    ...(input.containerId !== undefined ? { containerId: input.containerId } : {}),
    deploymentId: input.deploymentId,
    ...buildDrainStateUpdate(input.drain),
    promotionStage: input.promotionStage,
    ...buildUpstreamStateUpdate(input),
    updatedAt: new Date(),
  });
  if (deployment === undefined) {
    throw createDeploymentNotFoundError();
  }
}

function buildDrainStateUpdate(drain: RuntimeDrainState | null | undefined): DeploymentDrainStateUpdate {
  if (drain === undefined) {
    return {};
  }
  if (drain === null) {
    return {
      drainDeadlineAt: null,
      drainingContainerId: null,
      drainingDeploymentId: null,
      drainingNodeId: null,
    };
  }

  return {
    drainDeadlineAt: drain.drainDeadlineAt !== undefined ? new Date(drain.drainDeadlineAt) : null,
    drainingContainerId: drain.drainingContainerId,
    drainingDeploymentId: drain.drainingDeploymentId,
    drainingNodeId: drain.drainingNodeId,
  };
}

function buildUpstreamStateUpdate(input: WorkerUpdateDeploymentRuntimeRequest): DeploymentUpstreamStateUpdate {
  const upstreamTargetPresence: WorkerUpstreamTargetPresence = readWorkerUpstreamTargetPresence(input);
  if (upstreamTargetPresence === 'absent') {
    return {};
  }

  if (upstreamTargetPresence !== 'complete') {
    throw new Error(workerUpstreamTargetValidationMessage);
  }

  return {
    upstreamHost: input.upstreamHost,
    upstreamPort: input.upstreamPort,
  };
}

export async function appendDeploymentRuntimeEventForWorker(input: WorkerAppendDeploymentEventRequest): Promise<void> {
  await requireDeploymentRunDeployment(input);
  await appendDeploymentRunEvent({
    createdAt: input.timestamp !== undefined ? new Date(input.timestamp) : new Date(),
    deploymentId: input.deploymentId,
    deploymentRunId: input.deploymentRunId,
    id: createId('drev'),
    level: input.level,
    message: input.message,
    status: input.status ?? null,
    stepKey: input.stepKey,
    stream: input.stream,
  });
}

async function requireDeploymentRunDeployment(input: WorkerAppendDeploymentEventRequest): Promise<void> {
  const deployment: DeploymentRow | undefined = await findDeploymentRunDeployment({
    deploymentId: input.deploymentId,
    deploymentRunId: input.deploymentRunId,
  });
  if (deployment === undefined) {
    throw createDeploymentNotFoundError();
  }
}
