import {
  buildNodeDrainDeploymentRequest,
  type NodeDeployResponse,
  type RuntimeDrainState,
  type WorkerCompleteDeploymentResponse,
  type WorkerClaimedDeployment,
} from '@compartment/contracts';
import {
  completeDeployment,
  createNodeRequester,
  deployToNode,
  drainNodeDeployment,
  type CompartmentRequester,
  type NodeRequester,
} from '@compartment/sdk';
import {
  appendRuntimeStepEventSafely,
  buildDeploymentCompleteRequest,
  buildDeploymentEventContext,
  buildDeploymentDrainContext,
  buildPreparedRuntimeStateUpdate,
  buildRuntimeStateUpdate,
  writeRuntimeState,
} from './worker-deployment-tracking.service';
import type { DeploymentDrainContext, WorkerDeploymentEventContext } from './worker-deployment-tracking.types';
import { cleanupWorkerArtifacts } from './worker-artifact-cleanup.service';
import {
  appendDeploymentCompleted,
  appendReadinessSucceededEvent,
  requireDrainState,
  resolveRuntimeFailureStepKey,
} from './worker-runtime-deploy.service.helpers';
import type { WorkerArtifactRegistryConfig } from '../worker-artifact-registry.types';
import type { PreparedDeploymentResult, PrepareBuiltDeploymentCompletionInput } from './worker-runtime-deploy.types';
import { buildActiveRuntimeStateUpdate, buildNodeDeployRequest } from './worker-runtime-deploy.helpers';
import { releaseDeployment } from './worker-runtime-release.service';
import { runTrackedDeploymentStep } from './worker-step-runner.service';

export async function completeBuiltDeployment(
  request: CompartmentRequester,
  deployment: WorkerClaimedDeployment,
  imageRef: string,
  artifactRegistry: WorkerArtifactRegistryConfig,
  dockerNamespace: string,
  runtimeControlToken: string,
): Promise<void> {
  const preparedDeployment: PreparedDeploymentResult = await prepareBuiltDeploymentForCompletion({
    artifactRegistry,
    deployment,
    dockerNamespace,
    imageRef,
    request,
    runtimeControlToken,
  });
  await finalizeDeploymentDrain(
    request,
    deployment,
    preparedDeployment.nodeResponse,
    preparedDeployment.drainContext,
    runtimeControlToken,
  );
}

async function prepareBuiltDeploymentForCompletion(
  input: Readonly<PrepareBuiltDeploymentCompletionInput>,
): Promise<PreparedDeploymentResult> {
  const eventContext: WorkerDeploymentEventContext = buildDeploymentEventContext(input.request, input.deployment);
  const nodeRequest: NodeRequester = createWorkerNodeRequester(input.runtimeControlToken, input.deployment);
  await releaseDeployment(eventContext, nodeRequest, input.deployment, input.imageRef);
  const nodeResponse: NodeDeployResponse = await prepareCandidateDeployment(
    eventContext,
    nodeRequest,
    input.deployment,
    input.imageRef,
  );
  const drainContext: DeploymentDrainContext = buildDeploymentDrainContext(input.deployment);
  await persistPreparedDeployment(
    eventContext,
    input.deployment,
    input.imageRef,
    nodeResponse,
    drainContext,
    input.artifactRegistry,
    input.dockerNamespace,
  );
  return { drainContext, nodeResponse };
}

async function persistPreparedDeployment(
  eventContext: WorkerDeploymentEventContext,
  deployment: WorkerClaimedDeployment,
  imageRef: string,
  nodeResponse: NodeDeployResponse,
  drainContext: DeploymentDrainContext,
  artifactRegistry: WorkerArtifactRegistryConfig,
  dockerNamespace: string,
): Promise<void> {
  await runTrackedDeploymentStep({
    eventContext,
    failureSummary: 'route switch failed',
    run: async (): Promise<void> => {
      const response: WorkerCompleteDeploymentResponse = await completeDeployment(
        eventContext.request,
        buildDeploymentCompleteRequest(deployment, imageRef, nodeResponse, drainContext),
      );
      await cleanupWorkerArtifacts(response.cleanupArtifacts, artifactRegistry, dockerNamespace);
    },
    startMessage: 'switching active route',
    stepKey: 'switching_route',
  });
}

function createWorkerNodeRequester(runtimeControlToken: string, deployment: WorkerClaimedDeployment): NodeRequester {
  return createNodeRequester({
    internalToken: runtimeControlToken,
    nodeSocketPath: deployment.node.nodeSocketPath,
  });
}

async function finalizeDeploymentDrain(
  request: CompartmentRequester,
  deployment: WorkerClaimedDeployment,
  nodeResponse: NodeDeployResponse,
  drainContext: DeploymentDrainContext,
  runtimeControlToken: string,
): Promise<void> {
  const eventContext: WorkerDeploymentEventContext = buildDeploymentEventContext(request, deployment);
  if (drainContext.drain === undefined) {
    await appendDeploymentCompleted(eventContext);
    return;
  }

  try {
    await trackDeploymentDrain(eventContext, deployment, nodeResponse, drainContext, runtimeControlToken);
  } catch {
    // Drain is best-effort cleanup after the route has already switched.
  }

  await appendDeploymentCompleted(eventContext);
}

async function trackDeploymentDrain(
  eventContext: WorkerDeploymentEventContext,
  deployment: WorkerClaimedDeployment,
  nodeResponse: NodeDeployResponse,
  drainContext: DeploymentDrainContext,
  runtimeControlToken: string,
): Promise<void> {
  await runTrackedDeploymentStep({
    eventContext,
    failureSummary: 'drain failed',
    run: async (): Promise<void> =>
      await completeDeploymentDrain(eventContext, deployment, nodeResponse, drainContext, runtimeControlToken),
    startMessage: 'drain started',
    stepKey: 'draining_previous',
    successMessage: 'drain completed',
  });
}

async function prepareCandidateDeployment(
  eventContext: WorkerDeploymentEventContext,
  nodeRequest: NodeRequester,
  deployment: WorkerClaimedDeployment,
  imageRef: string,
): Promise<NodeDeployResponse> {
  await writeRuntimeState(eventContext.request, buildRuntimeStateUpdate(deployment.deploymentId, 'starting_candidate'));
  return await runTrackedDeploymentStep({
    eventContext,
    failureStepKey: resolveRuntimeFailureStepKey,
    failureSummary: 'runtime deployment failed',
    run: async (): Promise<NodeDeployResponse> =>
      await deployAndPersistCandidate(eventContext, nodeRequest, deployment, imageRef),
    startMessage: 'node deploy started',
    stepKey: 'starting_candidate',
  });
}

async function deployAndPersistCandidate(
  eventContext: WorkerDeploymentEventContext,
  nodeRequest: NodeRequester,
  deployment: WorkerClaimedDeployment,
  imageRef: string,
): Promise<NodeDeployResponse> {
  const nodeResponse: NodeDeployResponse = await deployCandidateToNode(nodeRequest, deployment, imageRef);
  await persistPreparedRuntimeState(eventContext, deployment, nodeResponse);
  return nodeResponse;
}

async function deployCandidateToNode(
  nodeRequest: NodeRequester,
  deployment: WorkerClaimedDeployment,
  imageRef: string,
): Promise<NodeDeployResponse> {
  return await deployToNode(nodeRequest, buildNodeDeployRequest(deployment, imageRef));
}

async function persistPreparedRuntimeState(
  eventContext: WorkerDeploymentEventContext,
  deployment: WorkerClaimedDeployment,
  nodeResponse: NodeDeployResponse,
): Promise<void> {
  await appendRuntimeStepEventSafely(
    eventContext,
    'starting_candidate',
    'succeeded',
    'runtime container started',
    nodeResponse.startedAt,
  );
  await appendReadinessSucceededEvent(eventContext, deployment.readiness, nodeResponse.startedAt);
  await writeRuntimeState(eventContext.request, buildPreparedRuntimeStateUpdate(deployment.deploymentId, nodeResponse));
}

async function completeDeploymentDrain(
  eventContext: WorkerDeploymentEventContext,
  deployment: WorkerClaimedDeployment,
  nodeResponse: NodeDeployResponse,
  drainContext: DeploymentDrainContext,
  runtimeControlToken: string,
): Promise<void> {
  const drain: RuntimeDrainState = requireDrainState(deployment, drainContext);
  await drainNodeDeployment(
    createDrainNodeRequester(runtimeControlToken, deployment, drainContext),
    buildNodeDrainDeploymentRequest(drain),
  );
  await writeRuntimeState(eventContext.request, buildActiveRuntimeStateUpdate(deployment.deploymentId, nodeResponse));
}

function createDrainNodeRequester(
  runtimeControlToken: string,
  deployment: WorkerClaimedDeployment,
  drainContext: DeploymentDrainContext,
): NodeRequester {
  const nodeSocketPath: string | undefined = drainContext.drainingNodeSocketPath;
  if (nodeSocketPath === undefined) {
    throw new Error(`Deployment ${deployment.deploymentId} is missing a draining node socket path.`);
  }
  return createNodeRequester({
    internalToken: runtimeControlToken,
    nodeSocketPath,
  });
}
