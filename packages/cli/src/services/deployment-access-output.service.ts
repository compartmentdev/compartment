import type { DeploymentReadSummary } from '@compartment/contracts';

export function appendDeploymentAccessProtectionMessage(
  baseMessage: string,
  deployments: readonly DeploymentReadSummary[],
): string {
  const hasProtectedRoute: boolean = deployments.some(
    (deployment: DeploymentReadSummary): boolean => deployment.routeUrl !== null && deployment.accessProtected === true,
  );
  return hasProtectedRoute
    ? `${baseMessage}\nProtected by app access — open in a browser and sign in to view.`
    : baseMessage;
}
