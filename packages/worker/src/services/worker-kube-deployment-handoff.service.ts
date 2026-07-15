import type { WorkerClaimedDeployment } from '@compartment/contracts';
import { kubeApplicationIdentityName, kubeNamespaceName } from '@compartment/kube-runtime';
import { prepareDeploymentReconcile, type CompartmentRequester } from '@compartment/sdk';

export async function handoffBuiltDeploymentToKube(
  request: CompartmentRequester,
  deployment: WorkerClaimedDeployment,
  imageRef: string,
): Promise<void> {
  const applicationName: string = kubeApplicationIdentityName(deployment.environmentId, deployment.service.id);
  await prepareDeploymentReconcile(request, {
    deploymentId: deployment.deploymentId,
    deploymentName: applicationName,
    imageRef,
    namespace: kubeNamespaceName(deployment.projectId),
    networkPolicyNames: [],
    routeHost: deployment.routeHost,
    serviceName: applicationName,
  });
}
