export function buildNoDeploymentsFoundMessage(projectName: string, environmentName: string): string {
  return `No deployments found for ${projectName}/${environmentName}.`;
}
