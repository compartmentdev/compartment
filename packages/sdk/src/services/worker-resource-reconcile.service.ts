import {
  workerAcknowledgeResourceReconcilePathname,
  workerAcknowledgeResourceReconcileRequestSchema,
  workerClaimResourceReconcilePathname,
  workerClaimResourceReconcileResponseSchema,
  type WorkerAcknowledgeResourceReconcileRequest,
  type WorkerClaimResourceReconcileResponse,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function claimResourceReconcile(
  request: CompartmentRequester,
): Promise<WorkerClaimResourceReconcileResponse> {
  return await request<WorkerClaimResourceReconcileResponse, undefined>({
    method: 'POST',
    path: workerClaimResourceReconcilePathname,
    schema: workerClaimResourceReconcileResponseSchema,
  });
}

export async function acknowledgeResourceReconcile(
  request: CompartmentRequester,
  body: WorkerAcknowledgeResourceReconcileRequest,
): Promise<WorkerAcknowledgeResourceReconcileRequest> {
  return await request<WorkerAcknowledgeResourceReconcileRequest, WorkerAcknowledgeResourceReconcileRequest>({
    body,
    method: 'POST',
    path: workerAcknowledgeResourceReconcilePathname,
    schema: workerAcknowledgeResourceReconcileRequestSchema,
  });
}
