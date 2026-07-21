import type {
  ProjectProvisioningTargetV2,
  WorkerClaimProjectProvisioningV2Response,
  WorkerCompleteProjectProvisioningResponse,
} from '@compartment/contracts';

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
