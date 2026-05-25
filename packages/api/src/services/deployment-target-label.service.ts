export function buildDeploymentTargetLabel(projectName: string, environmentName: string, serviceName: string): string {
  return `${projectName}/${environmentName}/${serviceName}`;
}
