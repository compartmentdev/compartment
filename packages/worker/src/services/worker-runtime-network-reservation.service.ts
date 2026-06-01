import type { NodeRuntimeNetworkReservationResponse, WorkerClaimedDeployment } from '@compartment/contracts';
import {
  cleanupNodeRuntimeNetworkReservation,
  createNodeRequester,
  reserveNodeRuntimeNetworks,
  type NodeRequester,
} from '@compartment/sdk';

const runtimeNetworkCleanupRequestTimeoutMs: number = 30_000;

export async function reserveClaimedDeploymentNetworks(
  runtimeControlToken: string,
  deployment: WorkerClaimedDeployment,
): Promise<NodeRuntimeNetworkReservationResponse> {
  return await reserveNodeRuntimeNetworks(createClaimedDeploymentNodeRequester(deployment, runtimeControlToken), {
    deploymentId: deployment.deploymentId,
    environmentId: deployment.environmentId,
    projectId: deployment.projectId,
    requiresResourceNetwork: deployment.runtimeNetwork.requiresResourceNetwork,
    serviceId: deployment.service.id,
    serviceNetworkEndpointReservations: readServiceNetworkEndpointReservations(deployment),
  });
}

export async function cleanupClaimedDeploymentNetworkReservationBestEffort(
  runtimeControlToken: string,
  deployment: WorkerClaimedDeployment,
  reservation: NodeRuntimeNetworkReservationResponse | undefined,
): Promise<void> {
  try {
    await cleanupNodeRuntimeNetworkReservation(
      createClaimedDeploymentNodeRequester(deployment, runtimeControlToken, runtimeNetworkCleanupRequestTimeoutMs),
      {
        networkNames: reservation?.newlyCreatedNetworkNames ?? [],
        reservationId: reservation?.reservationId ?? deployment.deploymentId,
      },
    );
  } catch {
    return;
  }
}

function readServiceNetworkEndpointReservations(deployment: WorkerClaimedDeployment): number {
  return deployment.readiness === null ? 1 : 2;
}

function createClaimedDeploymentNodeRequester(
  deployment: WorkerClaimedDeployment,
  runtimeControlToken: string,
  requestTimeoutMs?: number,
): NodeRequester {
  return createNodeRequester({
    internalToken: runtimeControlToken,
    nodeSocketPath: deployment.node.nodeSocketPath,
    ...(requestTimeoutMs !== undefined ? { requestTimeoutMs } : {}),
  });
}
