import type {
  DeploymentRunLogLine,
  DeploymentRunStepKey,
  DeploymentRunStepStatus,
  DeploymentRunStepSummary,
} from '@compartment/contracts';
import type { DeploymentRunEventInput } from '../../services/presenter.types';

interface StepAccumulator {
  completedAt: string | null;
  createdAt: string;
  deploymentId: string | null;
  message: string;
  serviceName: string | null;
  status: DeploymentRunStepStatus;
  stepKey: DeploymentRunStepKey;
}

export function buildDeploymentRunLogLine(
  event: DeploymentRunEventInput,
  serviceNameByDeploymentId: Map<string, string>,
): DeploymentRunLogLine {
  return {
    deploymentId: event.deploymentId,
    level: event.level,
    message: event.message,
    serviceName: readEventServiceName(event.deploymentId, serviceNameByDeploymentId),
    stepKey: event.stepKey,
    stream: event.stream,
    timestamp: event.createdAt.toISOString(),
  };
}

export function buildDeploymentRunSteps(
  events: DeploymentRunEventInput[],
  serviceNameByDeploymentId: Map<string, string>,
): DeploymentRunStepSummary[] {
  const stepsByKey: Map<string, StepAccumulator> = new Map<string, StepAccumulator>();

  for (const event of events) {
    appendDeploymentRunStep(stepsByKey, event, serviceNameByDeploymentId);
  }

  return [...stepsByKey.values()];
}

function appendDeploymentRunStep(
  stepsByKey: Map<string, StepAccumulator>,
  event: DeploymentRunEventInput,
  serviceNameByDeploymentId: Map<string, string>,
): void {
  if (event.status === null) {
    return;
  }

  const key: string = `${event.deploymentId ?? ''}\u0000${event.stepKey}`;
  const existing: StepAccumulator | undefined = stepsByKey.get(key);
  stepsByKey.set(
    key,
    existing === undefined
      ? buildStepAccumulator(event, serviceNameByDeploymentId)
      : updateStepAccumulator(existing, event),
  );
}

function buildStepAccumulator(
  event: DeploymentRunEventInput,
  serviceNameByDeploymentId: Map<string, string>,
): StepAccumulator {
  const status: DeploymentRunStepStatus = requireEventStepStatus(event);

  return {
    completedAt: readStepCompletedAt(status, event.createdAt),
    createdAt: event.createdAt.toISOString(),
    deploymentId: event.deploymentId,
    message: event.message,
    serviceName: readEventServiceName(event.deploymentId, serviceNameByDeploymentId),
    status,
    stepKey: event.stepKey,
  };
}

function updateStepAccumulator(existing: StepAccumulator, event: DeploymentRunEventInput): StepAccumulator {
  const status: DeploymentRunStepStatus = requireEventStepStatus(event);

  return {
    ...existing,
    completedAt: readStepCompletedAt(status, event.createdAt) ?? existing.completedAt,
    message: event.message,
    status,
  };
}

function readStepCompletedAt(status: DeploymentRunStepStatus, createdAt: Date): string | null {
  return status === 'running' ? null : createdAt.toISOString();
}

function requireEventStepStatus(event: DeploymentRunEventInput): DeploymentRunStepStatus {
  if (event.status === null) {
    throw new Error(`Deployment run event ${event.id} is missing step status.`);
  }

  return event.status;
}

function readEventServiceName(
  deploymentId: string | null,
  serviceNameByDeploymentId: Map<string, string>,
): string | null {
  return deploymentId === null ? null : (serviceNameByDeploymentId.get(deploymentId) ?? null);
}
