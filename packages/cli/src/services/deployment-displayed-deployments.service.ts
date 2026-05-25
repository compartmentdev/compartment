interface DeploymentSelectionResponse<TDeployment> {
  activeDeployments: TDeployment[];
  deployments: TDeployment[];
}

export function readDisplayedDeployments<TDeployment>(
  response: DeploymentSelectionResponse<TDeployment>,
): TDeployment[] {
  return response.deployments.length > 0 ? response.deployments : response.activeDeployments;
}
