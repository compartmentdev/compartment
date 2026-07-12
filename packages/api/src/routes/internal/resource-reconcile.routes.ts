import {
  buildFastifyResponseSchemas,
  workerAcknowledgeResourceReconcilePathname,
  workerAcknowledgeResourceReconcileRequestSchema,
  workerClaimResourceReconcilePathname,
  workerClaimResourceReconcileResponseSchema,
  type WorkerAcknowledgeResourceReconcileRequest,
  type WorkerClaimResourceReconcileResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import {
  acknowledgeResourceReconcile,
  claimNextResourceReconcile,
} from '../../services/resource-reconcile-run.service';

export function registerResourceReconcileRoutes(app: ApiApp): void {
  app.post(
    workerClaimResourceReconcilePathname,
    { schema: { response: buildFastifyResponseSchemas({ 200: workerClaimResourceReconcileResponseSchema }) } },
    handleClaim,
  );
  app.post(workerAcknowledgeResourceReconcilePathname, handleAcknowledge);
}

async function handleClaim(_request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const response: WorkerClaimResourceReconcileResponse = await claimNextResourceReconcile();
  return await reply.send(workerClaimResourceReconcileResponseSchema.parse(response));
}

async function handleAcknowledge(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const input: WorkerAcknowledgeResourceReconcileRequest = parseRequestValue(
    workerAcknowledgeResourceReconcileRequestSchema,
    request.body,
    'invalid_resource_reconcile_acknowledgement',
  );
  await acknowledgeResourceReconcile(input);
  return await reply.send(workerAcknowledgeResourceReconcileRequestSchema.parse(input));
}
