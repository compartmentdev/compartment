interface DeploymentKubeReferenceValueInput {
  deploymentId: string;
  deploymentName: string;
  id: string;
  namespace: string;
  networkPolicyNames: string[];
  serviceName: string;
}

export interface DeploymentKubeReferenceValues {
  createdAt: Date;
  deploymentId: string;
  deploymentName: string;
  id: string;
  namespace: string;
  networkPolicyNamesJson: string;
  observedAt: Date | null;
  revision: number;
  serviceName: string;
  state: 'desired';
  transitionedAt: Date;
  updatedAt: Date;
}

export function buildDeploymentKubeReferenceValues(
  input: DeploymentKubeReferenceValueInput,
  now: Date,
): DeploymentKubeReferenceValues {
  return {
    createdAt: now,
    deploymentId: input.deploymentId,
    deploymentName: input.deploymentName,
    id: input.id,
    namespace: input.namespace,
    networkPolicyNamesJson: JSON.stringify(input.networkPolicyNames),
    observedAt: null,
    revision: 0,
    serviceName: input.serviceName,
    state: 'desired',
    transitionedAt: now,
    updatedAt: now,
  };
}
