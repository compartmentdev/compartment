import {
  buildFastifyResponseSchemas,
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
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import {
  claimDeploymentReconcileTarget,
  observeDeploymentReconcile,
  prepareDeploymentReconcile,
} from '../../services/deployment-reconcile.service';

export function registerDeploymentReconcileRoutes(app: ApiApp): void {
  app.post(
    workerClaimDeploymentReconcilePathname,
    { schema: { response: buildFastifyResponseSchemas({ 200: workerClaimDeploymentReconcileResponseSchema }) } },
    handleClaim,
  );
  app.post(
    workerObserveDeploymentReconcilePathname,
    { schema: { response: buildFastifyResponseSchemas({ 200: workerObserveDeploymentReconcileResponseSchema }) } },
    handleObservation,
  );
  app.post(
    workerPrepareDeploymentReconcilePathname,
    { schema: { response: buildFastifyResponseSchemas({ 200: workerPrepareDeploymentReconcileResponseSchema }) } },
    handlePrepare,
  );
}

async function handlePrepare(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const input: WorkerPrepareDeploymentReconcileRequest = parseRequestValue(
    workerPrepareDeploymentReconcileRequestSchema,
    request.body,
    'invalid_deployment_reconcile_prepare',
  );
  await prepareDeploymentReconcile(input);
  const response: WorkerPrepareDeploymentReconcileResponse = { prepared: true };
  return await reply.send(workerPrepareDeploymentReconcileResponseSchema.parse(response));
}

async function handleClaim(_request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const response: WorkerClaimDeploymentReconcileResponse = { target: await claimDeploymentReconcileTarget() };
  return await reply.send(workerClaimDeploymentReconcileResponseSchema.parse(response));
}

async function handleObservation(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const input: WorkerObserveDeploymentReconcileRequest = parseRequestValue(
    workerObserveDeploymentReconcileRequestSchema,
    request.body,
    'invalid_deployment_reconcile_observation',
  );
  const response: WorkerObserveDeploymentReconcileResponse = { applied: await observeDeploymentReconcile(input) };
  return await reply.send(workerObserveDeploymentReconcileResponseSchema.parse(response));
}
