import {
  workerClaimProjectProvisioningPathname,
  workerClaimProjectProvisioningResponseSchema,
  workerCompleteProjectProvisioningPathname,
  workerCompleteProjectProvisioningRequestSchema,
  workerCompleteProjectProvisioningResponseSchema,
  type WorkerClaimProjectProvisioningResponse,
  type WorkerCompleteProjectProvisioningRequest,
  type WorkerCompleteProjectProvisioningResponse,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function claimProjectProvisioning(
  request: CompartmentRequester,
): Promise<WorkerClaimProjectProvisioningResponse> {
  return await request<WorkerClaimProjectProvisioningResponse, undefined>({
    method: 'POST',
    path: workerClaimProjectProvisioningPathname,
    schema: workerClaimProjectProvisioningResponseSchema,
  });
}

export async function completeProjectProvisioning(
  request: CompartmentRequester,
  body: WorkerCompleteProjectProvisioningRequest,
): Promise<WorkerCompleteProjectProvisioningResponse> {
  workerCompleteProjectProvisioningRequestSchema.parse(body);
  return await request<WorkerCompleteProjectProvisioningResponse, WorkerCompleteProjectProvisioningRequest>({
    body,
    method: 'POST',
    path: workerCompleteProjectProvisioningPathname,
    schema: workerCompleteProjectProvisioningResponseSchema,
  });
}
