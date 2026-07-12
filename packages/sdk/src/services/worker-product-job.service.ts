import {
  productJobIntentSchema,
  workerFinalizeProductJobPathname,
  workerFinalizeProductJobRequestSchema,
  workerClaimProductJobPathname,
  workerClaimProductJobResponseSchema,
  workerPersistProductJobIntentPathname,
  workerPersistProductJobResultPathname,
  workerPersistProductJobResultRequestSchema,
  type ProductJobIntent,
  type WorkerFinalizeProductJobRequest,
  type WorkerClaimProductJobResponse,
  type WorkerPersistProductJobResultRequest,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function persistProductJobIntent(
  request: CompartmentRequester,
  body: ProductJobIntent,
): Promise<ProductJobIntent> {
  return await request<ProductJobIntent, ProductJobIntent>({
    body,
    method: 'POST',
    path: workerPersistProductJobIntentPathname,
    schema: productJobIntentSchema,
  });
}

export async function claimProductJob(request: CompartmentRequester): Promise<WorkerClaimProductJobResponse> {
  return await request<WorkerClaimProductJobResponse, undefined>({
    method: 'POST',
    path: workerClaimProductJobPathname,
    schema: workerClaimProductJobResponseSchema,
  });
}

export async function persistProductJobResult(
  request: CompartmentRequester,
  body: WorkerPersistProductJobResultRequest,
): Promise<WorkerPersistProductJobResultRequest> {
  return await request<WorkerPersistProductJobResultRequest, WorkerPersistProductJobResultRequest>({
    body,
    method: 'POST',
    path: workerPersistProductJobResultPathname,
    schema: workerPersistProductJobResultRequestSchema,
  });
}

export async function finalizeProductJob(
  request: CompartmentRequester,
  body: WorkerFinalizeProductJobRequest,
): Promise<WorkerFinalizeProductJobRequest> {
  return await request<WorkerFinalizeProductJobRequest, WorkerFinalizeProductJobRequest>({
    body,
    method: 'POST',
    path: workerFinalizeProductJobPathname,
    schema: workerFinalizeProductJobRequestSchema,
  });
}
