import type { NodeReleaseResponse, WorkerClaimedDeployment } from '@compartment/contracts';
import { releaseNodeDeployment, type NodeRequester } from '@compartment/sdk';
import {
  appendRuntimeLogLineSafely,
  appendRuntimeStepEventSafely,
  buildRuntimeStateUpdate,
  writeRuntimeState,
} from './worker-deployment-tracking.service';
import type { WorkerDeploymentEventContext } from './worker-deployment-tracking.types';
import { buildNodeReleaseRequest } from './worker-runtime-deploy.helpers';
import { runTrackedDeploymentStep } from './worker-step-runner.service';

export async function releaseDeployment(
  eventContext: WorkerDeploymentEventContext,
  nodeRequest: NodeRequester,
  deployment: WorkerClaimedDeployment,
  imageRef: string,
): Promise<void> {
  if (deployment.release === null) {
    return;
  }

  await writeRuntimeState(eventContext.request, buildRuntimeStateUpdate(deployment.deploymentId, 'release'));
  const response: NodeReleaseResponse = await runTrackedDeploymentStep({
    eventContext,
    failureSummary: 'release failed',
    run: async (): Promise<NodeReleaseResponse> =>
      await releaseNodeDeployment(nodeRequest, buildNodeReleaseRequest(deployment, imageRef)),
    startMessage: 'release command started',
    stepKey: 'release',
  });
  await appendReleaseOutput(eventContext, response);
  await appendRuntimeStepEventSafely(eventContext, 'release', 'succeeded', 'release command completed');
}

async function appendReleaseOutput(
  eventContext: WorkerDeploymentEventContext,
  response: NodeReleaseResponse,
): Promise<void> {
  for (const line of response.logs) {
    if (line.message !== '') {
      await appendRuntimeLogLineSafely(eventContext, 'release', line.stream, line.message);
    }
  }
}
