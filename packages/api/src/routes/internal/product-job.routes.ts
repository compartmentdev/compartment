import {
  buildFastifyResponseSchemas,
  productJobIntentSchema,
  workerClaimProductJobPathname,
  workerClaimProductJobResponseSchema,
  workerFinalizeProductJobPathname,
  workerFinalizeProductJobRequestSchema,
  workerPersistProductJobIntentPathname,
  workerPersistProductJobResultPathname,
  workerPersistProductJobResultRequestSchema,
  type ProductJobIntent,
  type WorkerClaimProductJobResponse,
  type WorkerFinalizeProductJobRequest,
  type WorkerPersistProductJobResultRequest,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import {
  claimNextProductJob,
  completeProductJob,
  createProductJobIntent,
  finalizeProductJob,
} from '../../services/product-job.service';
import type { ClaimedProductJobResult } from '../../services/product-job.service.types';

const productJobResultBodyLimit: number = 100 * 1024 * 1024;

export function registerProductJobRoutes(app: ApiApp): void {
  registerPersistProductJobIntentRoute(app);
  registerClaimProductJobRoute(app);
  registerPersistProductJobResultRoute(app);
  registerFinalizeProductJobRoute(app);
}

function registerPersistProductJobIntentRoute(app: ApiApp): void {
  app.post(workerPersistProductJobIntentPathname, handlePersistProductJobIntent);
}

function registerClaimProductJobRoute(app: ApiApp): void {
  app.post(
    workerClaimProductJobPathname,
    { schema: { response: buildFastifyResponseSchemas({ 200: workerClaimProductJobResponseSchema }) } },
    handleClaimProductJob,
  );
}

function registerPersistProductJobResultRoute(app: ApiApp): void {
  app.post(
    workerPersistProductJobResultPathname,
    { bodyLimit: productJobResultBodyLimit },
    handlePersistProductJobResult,
  );
}

function registerFinalizeProductJobRoute(app: ApiApp): void {
  app.post(workerFinalizeProductJobPathname, handleFinalizeProductJob);
}

async function handlePersistProductJobIntent(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const input: ProductJobIntent = parseRequestValue(productJobIntentSchema, request.body, 'invalid_product_job_intent');
  await createProductJobIntent(input);
  return await reply.send(productJobIntentSchema.parse(input));
}

async function handleClaimProductJob(_request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const claimed: ClaimedProductJobResult = await claimNextProductJob();
  const response: WorkerClaimProductJobResponse = { job: claimed.intent, result: claimed.persistedResult };
  return await reply.send(workerClaimProductJobResponseSchema.parse(response));
}

async function handlePersistProductJobResult(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const input: WorkerPersistProductJobResultRequest = parseRequestValue(
    workerPersistProductJobResultRequestSchema,
    request.body,
    'invalid_product_job_result',
  );
  await completeProductJob(input);
  return await reply.send(workerPersistProductJobResultRequestSchema.parse(input));
}

async function handleFinalizeProductJob(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const input: WorkerFinalizeProductJobRequest = parseRequestValue(
    workerFinalizeProductJobRequestSchema,
    request.body,
    'invalid_product_job_finalization',
  );
  await finalizeProductJob(input);
  return await reply.send(workerFinalizeProductJobRequestSchema.parse(input));
}
