import type { RollbackDeploymentRequest } from '@compartment/contracts';
import type {
  DeploymentMovementServiceScope,
  RollbackDeploymentServiceSelection,
  RollbackDeploymentTarget,
} from '../../services/deployment-movement.service.types';

export function buildRollbackDeploymentTarget(input: RollbackDeploymentRequest): RollbackDeploymentTarget {
  if (input.targetDeploymentId !== undefined) {
    return {
      mode: 'deployment',
      serviceSelection: buildRollbackDeploymentServiceSelection(input.serviceName),
      targetDeploymentId: input.targetDeploymentId,
    };
  }
  if (input.targetDeploymentRunId !== undefined) {
    return {
      mode: 'run',
      targetDeploymentRunId: input.targetDeploymentRunId,
    };
  }

  return {
    mode: 'previous',
    scope: buildDeploymentMovementServiceScope(input.serviceName),
  };
}

export function buildDeploymentMovementServiceScope(serviceName: string | undefined): DeploymentMovementServiceScope {
  if (serviceName === undefined) {
    return {
      mode: 'all-services',
    };
  }

  return {
    mode: 'service',
    serviceName,
  };
}

function buildRollbackDeploymentServiceSelection(serviceName: string | undefined): RollbackDeploymentServiceSelection {
  if (serviceName === undefined) {
    return {
      mode: 'infer-service',
    };
  }

  return {
    mode: 'service',
    serviceName,
  };
}
