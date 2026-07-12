import {
  workerClaimDeploymentReconcilePathname,
  workerClaimDeploymentReconcileResponseSchema,
  workerObserveDeploymentReconcilePathname,
  workerObserveDeploymentReconcileRequestSchema,
  workerObserveDeploymentReconcileResponseSchema,
  workerPrepareDeploymentReconcilePathname,
  workerPrepareDeploymentReconcileRequestSchema,
  workerPrepareDeploymentReconcileResponseSchema,
  type WorkerClaimDeploymentReconcileResponse,
  type WorkerObserveDeploymentReconcileRequest,
  type WorkerObserveDeploymentReconcileResponse,
  type WorkerPrepareDeploymentReconcileRequest,
  type WorkerPrepareDeploymentReconcileResponse,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function claimDeploymentReconcile(
  request: CompartmentRequester,
): Promise<WorkerClaimDeploymentReconcileResponse> {
  return await request<WorkerClaimDeploymentReconcileResponse, undefined>({
    method: 'POST',
    path: workerClaimDeploymentReconcilePathname,
    schema: workerClaimDeploymentReconcileResponseSchema,
  });
}

export async function prepareDeploymentReconcile(
  request: CompartmentRequester,
  body: WorkerPrepareDeploymentReconcileRequest,
): Promise<WorkerPrepareDeploymentReconcileResponse> {
  workerPrepareDeploymentReconcileRequestSchema.parse(body);
  return await request<WorkerPrepareDeploymentReconcileResponse, WorkerPrepareDeploymentReconcileRequest>({
    body,
    method: 'POST',
    path: workerPrepareDeploymentReconcilePathname,
    schema: workerPrepareDeploymentReconcileResponseSchema,
  });
}

export async function observeDeploymentReconcile(
  request: CompartmentRequester,
  body: WorkerObserveDeploymentReconcileRequest,
): Promise<WorkerObserveDeploymentReconcileResponse> {
  workerObserveDeploymentReconcileRequestSchema.parse(body);
  return await request<WorkerObserveDeploymentReconcileResponse, WorkerObserveDeploymentReconcileRequest>({
    body,
    method: 'POST',
    path: workerObserveDeploymentReconcilePathname,
    schema: workerObserveDeploymentReconcileResponseSchema,
  });
}
