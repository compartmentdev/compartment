import {
  buildFastifyResponseSchemas,
  workerClaimCustomDomainReconcilePathname,
  workerClaimCustomDomainReconcileResponseSchema,
  workerCompleteCustomDomainReconcilePathname,
  workerCompleteCustomDomainReconcileRequestSchema,
  workerCustomDomainReconcileMutationResponseSchema,
  workerFailCustomDomainReconcilePathname,
  workerFailCustomDomainReconcileRequestSchema,
  workerObserveCustomDomainReconcilePathname,
  workerObserveCustomDomainReconcileRequestSchema,
  type WorkerCompleteCustomDomainReconcileRequest,
  type WorkerFailCustomDomainReconcileRequest,
  type WorkerObserveCustomDomainReconcileRequest,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import {
  claimNextCustomDomainReconcile,
  completeCustomDomainReconcile,
  failCustomDomainReconcile,
  observeCustomDomainReconcile,
} from '../../services/custom-domain-reconcile.service';

export function registerCustomDomainReconcileRoutes(app: ApiApp): void {
  app.post(
    workerClaimCustomDomainReconcilePathname,
    { schema: { response: buildFastifyResponseSchemas({ 200: workerClaimCustomDomainReconcileResponseSchema }) } },
    handleClaim,
  );
  app.post(workerObserveCustomDomainReconcilePathname, handleObserve);
  app.post(workerCompleteCustomDomainReconcilePathname, handleComplete);
  app.post(workerFailCustomDomainReconcilePathname, handleFailure);
}

async function handleClaim(_request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  return await reply.send(workerClaimCustomDomainReconcileResponseSchema.parse(await claimNextCustomDomainReconcile()));
}

async function handleObserve(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const input: WorkerObserveCustomDomainReconcileRequest = parseRequestValue(
    workerObserveCustomDomainReconcileRequestSchema,
    request.body,
    'invalid_custom_domain_reconcile_observation',
  );
  return await reply.send(
    workerCustomDomainReconcileMutationResponseSchema.parse(await observeCustomDomainReconcile(input)),
  );
}

async function handleComplete(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const input: WorkerCompleteCustomDomainReconcileRequest = parseRequestValue(
    workerCompleteCustomDomainReconcileRequestSchema,
    request.body,
    'invalid_custom_domain_reconcile_completion',
  );
  return await reply.send(
    workerCustomDomainReconcileMutationResponseSchema.parse(await completeCustomDomainReconcile(input)),
  );
}

async function handleFailure(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const input: WorkerFailCustomDomainReconcileRequest = parseRequestValue(
    workerFailCustomDomainReconcileRequestSchema,
    request.body,
    'invalid_custom_domain_reconcile_failure',
  );
  return await reply.send(
    workerCustomDomainReconcileMutationResponseSchema.parse(await failCustomDomainReconcile(input)),
  );
}
