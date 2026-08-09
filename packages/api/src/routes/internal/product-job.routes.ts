import {
  buildFastifyResponseSchemas,
  productJobIntentSchema,
  workerClaimProductJobRequestSchema,
  workerClaimProductJobPathname,
  workerClaimProductJobResponseSchema,
  workerFinalizeProductJobPathname,
  workerFinalizeProductJobRequestSchema,
  workerPersistProductJobIntentPathname,
  workerPersistProductJobIntentResponseSchema,
  workerPersistProductJobResultPathname,
  workerPersistProductJobResultRequestSchema,
  type ProductJobIntent,
  type WorkerClaimProductJobRequest,
  type WorkerClaimProductJobResponse,
  type WorkerFinalizeProductJobRequest,
  type WorkerPersistProductJobResultRequest,
  type WorkerPersistProductJobIntentResponse,
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
  app.post(
    workerPersistProductJobIntentPathname,
    { schema: { response: buildFastifyResponseSchemas({ 200: workerPersistProductJobIntentResponseSchema }) } },
    handlePersistProductJobIntent,
  );
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
  const response: WorkerPersistProductJobIntentResponse = { result: await createProductJobIntent(input) };
  return await reply.send(workerPersistProductJobIntentResponseSchema.parse(response));
}

async function handleClaimProductJob(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const input: WorkerClaimProductJobRequest = parseRequestValue(
    workerClaimProductJobRequestSchema,
    request.body,
    'invalid_product_job_claim',
  );
  const claimed: ClaimedProductJobResult = await claimNextProductJob(input.jobClass);
  const response: WorkerClaimProductJobResponse = {
    job: claimed.intent,
    resourceReadiness: claimed.resourceReadiness,
    result: claimed.persistedResult,
  };
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
