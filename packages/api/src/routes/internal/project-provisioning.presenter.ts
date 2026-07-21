import type {
  ProjectProvisioningTarget,
  ProjectProvisioningTargetV2,
  WorkerClaimProjectProvisioningResponse,
  WorkerClaimProjectProvisioningV2Response,
  WorkerCompleteProjectProvisioningResponse,
} from '@compartment/contracts';

export function buildWorkerClaimProjectProvisioningResponse(
  target: ProjectProvisioningTarget | null,
): WorkerClaimProjectProvisioningResponse {
  return { target };
}

export function buildWorkerClaimProjectProvisioningV2Response(
  target: ProjectProvisioningTargetV2 | null,
): WorkerClaimProjectProvisioningV2Response {
  return { target };
}

export function buildWorkerCompleteProjectProvisioningResponse(
  applied: boolean,
): WorkerCompleteProjectProvisioningResponse {
  return { applied };
}
