import type { DeployResponse, DeploymentStatusResponse, DeploymentSummary } from '@compartment/contracts';
import {
  getDeploymentStatus,
  isRetryableTransportRequestError,
  type CompartmentRequester,
  type RequestTransportFailure,
} from '@compartment/sdk';
import { createAuthenticatedRequester, requireOrganizationContext } from './context.service';
import type { AuthenticatedContext } from './context.types';
import {
  buildAggregatedDeploymentStatus,
  ensurePolledDeployments,
  isCompletedDeploymentStatus,
  throwIfDeploymentBatchFailed,
} from './deployment-status-batch.service';
import type { DeploymentPollContext, DeploymentStatusBatchResult, DeploymentStatusReporter } from './deployments.types';

const deploymentPollIntervalMs: number = 1_000;
const maxDeploymentPollTransportFailureCount: number = 30;

interface DeploymentPollRetryState {
  transportFailureCount: number;
}

export function createProjectRequester(context: AuthenticatedContext): CompartmentRequester {
  return createAuthenticatedRequester(requireOrganizationContext(context), {
    includeCurrentOrganization: true,
  });
}

export async function waitForDeploymentOperationCompletion(
  request: CompartmentRequester,
  response: DeployResponse,
  serviceName: string | undefined,
  onStatusUpdate?: DeploymentStatusReporter,
): Promise<DeploymentStatusResponse> {
  const deployments: DeploymentSummary[] = requireDeployments(response);
  const context: DeploymentPollContext = createDeploymentPollContext(response, serviceName);
  const retryState: DeploymentPollRetryState = { transportFailureCount: 0 };

  for (;;) {
    const pollResult: DeploymentStatusBatchResult = await readNextDeploymentPollResult(
      request,
      context,
      deployments,
      retryState,
    );
    const completedStatus: DeploymentStatusResponse | null = handlePolledDeploymentBatch(pollResult, onStatusUpdate);
    if (completedStatus !== null) {
      return completedStatus;
    }

    await waitForDeploymentPoll();
  }
}

async function readNextDeploymentPollResult(
  request: CompartmentRequester,
  context: DeploymentPollContext,
  deployments: DeploymentSummary[],
  retryState: DeploymentPollRetryState,
): Promise<DeploymentStatusBatchResult> {
  for (;;) {
    const pollResult: DeploymentStatusBatchResult | null = await pollDeploymentBatchWithTransientRetry(
      request,
      context,
      deployments,
      retryState.transportFailureCount,
    );
    if (pollResult !== null) {
      retryState.transportFailureCount = 0;
      return pollResult;
    }

    retryState.transportFailureCount += 1;
    await waitForDeploymentPoll();
  }
}

async function pollDeploymentBatchWithTransientRetry(
  request: CompartmentRequester,
  context: DeploymentPollContext,
  deployments: DeploymentSummary[],
  transportFailureCount: number,
): Promise<DeploymentStatusBatchResult | null> {
  try {
    return await pollDeploymentBatch(request, context, deployments);
  } catch (error) {
    if (
      !isRetryableTransportRequestError(error as RequestTransportFailure) ||
      transportFailureCount >= maxDeploymentPollTransportFailureCount
    ) {
      throw error;
    }

    return null;
  }
}

function createDeploymentPollContext(response: DeployResponse, serviceName: string | undefined): DeploymentPollContext {
  return {
    environmentName: response.environment.name,
    projectName: response.project.name,
    serviceName,
  };
}

function handlePolledDeploymentBatch(
  pollResult: DeploymentStatusBatchResult,
  onStatusUpdate: DeploymentStatusReporter | undefined,
): DeploymentStatusResponse | null {
  onStatusUpdate?.(pollResult.aggregatedStatus);
  throwIfDeploymentBatchFailed(pollResult.statuses);

  return pollResult.completed ? pollResult.aggregatedStatus : null;
}

async function waitForDeploymentPoll(): Promise<void> {
  await new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, deploymentPollIntervalMs);
  });
}

function requireDeployments(response: DeployResponse): DeploymentSummary[] {
  if (response.deployments.length === 0) {
    throw new Error('Deploy did not return any deployments.');
  }

  return response.deployments;
}

async function pollDeploymentBatch(
  request: CompartmentRequester,
  context: DeploymentPollContext,
  deployments: DeploymentSummary[],
): Promise<DeploymentStatusBatchResult> {
  const statuses: DeploymentStatusResponse[] = await Promise.all(
    deployments.map(
      async (deployment: DeploymentSummary): Promise<DeploymentStatusResponse> =>
        await getDeploymentStatus(request, {
          deploymentId: deployment.id,
          environmentName: context.environmentName,
          projectName: context.projectName,
          serviceName: deployment.serviceName,
        }),
    ),
  );
  ensurePolledDeployments(statuses, deployments);

  return {
    aggregatedStatus: buildAggregatedDeploymentStatus(statuses, deployments),
    completed: statuses.every(isCompletedDeploymentStatus),
    statuses,
  };
}
