import {
  workerClaimProjectProvisioningV2Pathname,
  workerClaimProjectProvisioningV2RequestSchema,
  workerClaimProjectProvisioningV2ResponseSchema,
  workerCompleteProjectProvisioningResponseSchema,
  workerCompleteProjectProvisioningV2Pathname,
  workerCompleteProjectProvisioningV2RequestSchema,
  type WorkerClaimProjectProvisioningV2Response,
  type WorkerClaimProjectProvisioningV2Request,
  type WorkerCompleteProjectProvisioningResponse,
  type WorkerCompleteProjectProvisioningV2Request,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function claimProjectProvisioningV2(
  request: CompartmentRequester,
  body: WorkerClaimProjectProvisioningV2Request,
): Promise<WorkerClaimProjectProvisioningV2Response> {
  workerClaimProjectProvisioningV2RequestSchema.parse(body);
  return await request<WorkerClaimProjectProvisioningV2Response, WorkerClaimProjectProvisioningV2Request>({
    body,
    method: 'POST',
    path: workerClaimProjectProvisioningV2Pathname,
    schema: workerClaimProjectProvisioningV2ResponseSchema,
  });
}

export async function completeProjectProvisioningV2(
  request: CompartmentRequester,
  body: WorkerCompleteProjectProvisioningV2Request,
): Promise<WorkerCompleteProjectProvisioningResponse> {
  workerCompleteProjectProvisioningV2RequestSchema.parse(body);
  return await request<WorkerCompleteProjectProvisioningResponse, WorkerCompleteProjectProvisioningV2Request>({
    body,
    method: 'POST',
    path: workerCompleteProjectProvisioningV2Pathname,
    schema: workerCompleteProjectProvisioningResponseSchema,
  });
}
