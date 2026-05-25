import type {
  ResolvedOptionalServiceReadinessConfig,
  RuntimeDrainState,
  WorkerClaimedDeployment,
} from '@compartment/contracts';
import { appendRuntimeStepEventSafely } from './worker-deployment-tracking.service';
import type { DeploymentDrainContext, WorkerDeploymentEventContext } from './worker-deployment-tracking.types';
import { buildRuntimeReadyEventMessage } from './worker-runtime-deploy.helpers';

export async function appendReadinessSucceededEvent(
  eventContext: WorkerDeploymentEventContext,
  readiness: ResolvedOptionalServiceReadinessConfig,
  timestamp: string,
): Promise<void> {
  if (readiness === null) {
    return;
  }

  await appendRuntimeStepEventSafely(
    eventContext,
    'checking_readiness',
    'succeeded',
    buildRuntimeReadyEventMessage(readiness),
    timestamp,
  );
}

export async function appendDeploymentCompleted(eventContext: WorkerDeploymentEventContext): Promise<void> {
  await appendRuntimeStepEventSafely(eventContext, 'completed', 'succeeded', 'deployment completed');
}

export function requireDrainState(
  deployment: WorkerClaimedDeployment,
  drainContext: DeploymentDrainContext,
): RuntimeDrainState {
  if (drainContext.drain === undefined) {
    throw new Error(`Deployment ${deployment.deploymentId} is missing drain state.`);
  }

  return drainContext.drain;
}

export function resolveRuntimeFailureStepKey(error: Error | undefined): 'starting_candidate' | 'checking_readiness' {
  return error?.message.startsWith('runtime readiness failed:') === true ? 'checking_readiness' : 'starting_candidate';
}
