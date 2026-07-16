import {
  workerFinalizeProductJobPathname,
  workerFinalizeProductJobRequestSchema,
  workerClaimProductJobPathname,
  workerClaimProductJobResponseSchema,
  workerPersistProductJobIntentPathname,
  workerPersistProductJobIntentResponseSchema,
  workerPersistProductJobResultPathname,
  workerPersistProductJobResultRequestSchema,
  type ProductJobIntent,
  type WorkerClaimProductJobRequest,
  type WorkerFinalizeProductJobRequest,
  type WorkerClaimProductJobResponse,
  type WorkerPersistProductJobResultRequest,
  type WorkerPersistProductJobIntentResponse,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function persistProductJobIntent(
  request: CompartmentRequester,
  body: ProductJobIntent,
): Promise<WorkerPersistProductJobIntentResponse> {
  return await request<WorkerPersistProductJobIntentResponse, ProductJobIntent>({
    body,
    method: 'POST',
    path: workerPersistProductJobIntentPathname,
    schema: workerPersistProductJobIntentResponseSchema,
  });
}

export async function claimProductJob(
  request: CompartmentRequester,
  body: WorkerClaimProductJobRequest,
): Promise<WorkerClaimProductJobResponse> {
  return await request<WorkerClaimProductJobResponse, WorkerClaimProductJobRequest>({
    body,
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
