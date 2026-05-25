import {
  buildDeploymentDrainDeadline,
  type DeploymentLogStream,
  type DeploymentRunLogLevel,
  type DeploymentRunStepKey,
  type DeploymentRunStepStatus,
  type DeploymentPromotionStage,
  type NodeDeployResponse,
  type WorkerAppendDeploymentEventRequest,
  type WorkerClaimedDeployment,
  type WorkerCompleteDeploymentRequest,
  type WorkerUpdateDeploymentRuntimeRequest,
} from '@compartment/contracts';
import { appendDeploymentEvent, type CompartmentRequester, updateDeploymentRuntime } from '@compartment/sdk';
import type {
  AppendRuntimeEventInput,
  DeploymentDrainContext,
  WorkerDeploymentEventContext,
} from './worker-deployment-tracking.types';

export function buildDeploymentEventContext(
  request: CompartmentRequester,
  deployment: WorkerClaimedDeployment,
): WorkerDeploymentEventContext {
  return {
    deploymentId: deployment.deploymentId,
    deploymentRunId: deployment.deploymentRunId,
    request,
  };
}

export function buildDeploymentCompleteRequest(
  deployment: WorkerClaimedDeployment,
  imageRef: string,
  nodeResponse: NodeDeployResponse,
  drainContext: DeploymentDrainContext,
): WorkerCompleteDeploymentRequest {
  return {
    containerId: nodeResponse.containerId,
    deploymentId: deployment.deploymentId,
    ...(drainContext.drain !== undefined ? { drain: drainContext.drain } : {}),
    imageRef,
    routeHost: nodeResponse.routeHost,
    upstreamHost: nodeResponse.upstreamHost,
    upstreamPort: nodeResponse.upstreamPort,
  };
}

export function buildDeploymentDrainContext(deployment: WorkerClaimedDeployment): DeploymentDrainContext {
  if (deployment.previousDeployment === undefined) {
    return {};
  }

  return {
    drain: {
      drainDeadlineAt: buildDeploymentDrainDeadline(),
      drainingContainerId: deployment.previousDeployment.containerId,
      drainingDeploymentId: deployment.previousDeployment.deploymentId,
      drainingNodeId: deployment.previousDeployment.nodeId,
    },
    drainingNodeSocketPath: deployment.previousDeployment.nodeSocketPath,
  };
}

export function buildPreparedRuntimeStateUpdate(
  deploymentId: string,
  nodeResponse: NodeDeployResponse,
): WorkerUpdateDeploymentRuntimeRequest {
  return {
    containerId: nodeResponse.containerId,
    deploymentId,
    promotionStage: 'switching_route',
    upstreamHost: nodeResponse.upstreamHost,
    upstreamPort: nodeResponse.upstreamPort,
  };
}

export function buildRuntimeStateUpdate(
  deploymentId: string,
  promotionStage: DeploymentPromotionStage,
): WorkerUpdateDeploymentRuntimeRequest {
  return {
    deploymentId,
    promotionStage,
  };
}

export async function writeRuntimeState(
  request: CompartmentRequester,
  input: WorkerUpdateDeploymentRuntimeRequest,
): Promise<void> {
  await updateDeploymentRuntime(request, input);
}

export async function appendRuntimeLogLineSafely(
  context: WorkerDeploymentEventContext,
  stepKey: DeploymentRunStepKey,
  stream: DeploymentLogStream,
  message: string,
  level: DeploymentRunLogLevel = 'info',
): Promise<void> {
  await appendRuntimeEventSafely(context, {
    level,
    message,
    stepKey,
    stream,
  });
}

export async function appendRuntimeStepEventSafely(
  context: WorkerDeploymentEventContext,
  stepKey: DeploymentRunStepKey,
  status: DeploymentRunStepStatus,
  message: string,
  timestamp: string | undefined = undefined,
  level: DeploymentRunLogLevel = 'info',
): Promise<void> {
  await appendRuntimeEventSafely(context, {
    level,
    message,
    status,
    stepKey,
    timestamp,
  });
}

async function appendRuntimeEventSafely(
  context: WorkerDeploymentEventContext,
  input: AppendRuntimeEventInput,
): Promise<void> {
  const event: WorkerAppendDeploymentEventRequest = {
    deploymentId: context.deploymentId,
    deploymentRunId: context.deploymentRunId,
    level: input.level ?? 'info',
    message: input.message,
    ...(input.status !== undefined ? { status: input.status } : {}),
    stepKey: input.stepKey,
    stream: input.stream ?? 'compartment',
    ...(input.timestamp !== undefined ? { timestamp: input.timestamp } : {}),
  };

  await appendDeploymentEvent(context.request, event).catch((): void => undefined);
}
