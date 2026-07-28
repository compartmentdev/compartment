import {
  workerClaimCustomDomainReconcilePathname,
  workerClaimCustomDomainReconcileResponseSchema,
  workerCompleteCustomDomainReconcilePathname,
  workerCustomDomainReconcileMutationResponseSchema,
  workerFailCustomDomainReconcilePathname,
  workerObserveCustomDomainReconcilePathname,
  type WorkerClaimCustomDomainReconcileResponse,
  type WorkerCompleteCustomDomainReconcileRequest,
  type WorkerCustomDomainReconcileMutationResponse,
  type WorkerFailCustomDomainReconcileRequest,
  type WorkerObserveCustomDomainReconcileRequest,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function claimCustomDomainReconcile(
  request: CompartmentRequester,
): Promise<WorkerClaimCustomDomainReconcileResponse> {
  return await request({
    method: 'POST',
    path: workerClaimCustomDomainReconcilePathname,
    schema: workerClaimCustomDomainReconcileResponseSchema,
  });
}

export async function observeCustomDomainReconcile(
  request: CompartmentRequester,
  body: WorkerObserveCustomDomainReconcileRequest,
): Promise<WorkerCustomDomainReconcileMutationResponse> {
  return await mutate(request, workerObserveCustomDomainReconcilePathname, body);
}

export async function completeCustomDomainReconcile(
  request: CompartmentRequester,
  body: WorkerCompleteCustomDomainReconcileRequest,
): Promise<WorkerCustomDomainReconcileMutationResponse> {
  return await mutate(request, workerCompleteCustomDomainReconcilePathname, body);
}

export async function failCustomDomainReconcile(
  request: CompartmentRequester,
  body: WorkerFailCustomDomainReconcileRequest,
): Promise<WorkerCustomDomainReconcileMutationResponse> {
  return await mutate(request, workerFailCustomDomainReconcilePathname, body);
}

async function mutate<Body>(
  request: CompartmentRequester,
  path: string,
  body: Body,
): Promise<WorkerCustomDomainReconcileMutationResponse> {
  return await request<WorkerCustomDomainReconcileMutationResponse, Body>({
    body,
    method: 'POST',
    path,
    schema: workerCustomDomainReconcileMutationResponseSchema,
  });
}
