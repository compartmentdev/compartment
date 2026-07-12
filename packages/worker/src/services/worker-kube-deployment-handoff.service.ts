import type { NodeRuntimeNetworkReservationResponse, WorkerClaimedDeployment } from '@compartment/contracts';
import { kubeApplicationIdentityName, kubeNamespaceName } from '@compartment/kube-runtime';
import { prepareDeploymentReconcile, type CompartmentRequester } from '@compartment/sdk';
import { isKubeRuntimeConfigured } from '../kube-controller-host';
import { reserveClaimedDeploymentNetworks } from './worker-runtime-network-reservation.service';

export async function reserveLegacyDeploymentNetworksIfNeeded(
  runtimeControlToken: string,
  deployment: WorkerClaimedDeployment,
): Promise<NodeRuntimeNetworkReservationResponse | undefined> {
  if (isKubeRuntimeConfigured()) {
    return undefined;
  }
  return await reserveClaimedDeploymentNetworks(runtimeControlToken, deployment);
}

export async function handoffBuiltDeploymentToKubeIfConfigured(
  request: CompartmentRequester,
  deployment: WorkerClaimedDeployment,
  imageRef: string,
): Promise<boolean> {
  if (!isKubeRuntimeConfigured()) {
    return false;
  }
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
  return true;
}
