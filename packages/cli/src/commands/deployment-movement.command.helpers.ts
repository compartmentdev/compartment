import type { DeploymentCommandServiceScope } from '../services/deployment-movement.types';

export function createDeploymentCommandServiceScope(serviceName: string | undefined): DeploymentCommandServiceScope {
  if (serviceName === undefined) {
    return {
      kind: 'all',
    };
  }

  return {
    kind: 'service',
    serviceName,
  };
}
