import type {
  ProjectProvisioningTarget,
  WorkerClaimProjectProvisioningResponse,
  WorkerCompleteProjectProvisioningResponse,
} from '@compartment/contracts';

export function buildWorkerClaimProjectProvisioningResponse(
  target: ProjectProvisioningTarget | null,
): WorkerClaimProjectProvisioningResponse {
  return { target };
}

export function buildWorkerCompleteProjectProvisioningResponse(
  applied: boolean,
): WorkerCompleteProjectProvisioningResponse {
  return { applied };
}
