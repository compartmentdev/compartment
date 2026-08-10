import {
  buildFastifyResponseSchemas,
  claimAccountRequestSchema,
  claimAccountResponseSchema,
  type ClaimAccountRequest,
  type ClaimAccountResponse,
} from '@compartment/contracts';
import { readHeaderValue } from '@compartment/utils';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import '../../http/request.types';
import { parseRequestValue } from '../../http/validation';
import { recordAccountClaimAuditEvents } from '../../services/claim-account-audit.service';
import type { AccountClaimAuditRequestContext } from '../../services/claim-account-audit.service.types';
import { claimAccount } from '../../services/claim-account.service';
import { buildPrincipalSummary } from '../presenters/principal.presenter';
import { authApiClaimPathname } from './auth-api-paths';
import { authClaimRateLimitRouteOptions } from './auth-rate-limit.route';

export function registerPostClaimRoute(app: ApiApp): void {
  app.post(
    authApiClaimPathname,
    {
      ...authClaimRateLimitRouteOptions,
      schema: {
        response: buildFastifyResponseSchemas({
          200: claimAccountResponseSchema,
        }),
      },
    },
    handlePostClaim,
  );
}

async function handlePostClaim(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const requestBody: ClaimAccountRequest = parseRequestValue(
    claimAccountRequestSchema,
    request.body,
    'invalid_claim_account_request',
  );
  const previousEmail: string = request.actor.principalEmail;

  await claimAccount({
    email: requestBody.email,
    password: requestBody.password,
    principalId: request.actor.principalId,
  });
  await recordAccountClaimAuditEvents({
    context: buildAccountClaimAuditRequestContext(request),
    email: requestBody.email,
    previousEmail,
    principalId: request.actor.principalId,
  });
  const response: ClaimAccountResponse = claimAccountResponseSchema.parse({
    principal: buildPrincipalSummary({
      email: requestBody.email,
      id: request.actor.principalId,
      type: request.actor.principalType,
    }),
  });

  return await reply.send(response);
}

function buildAccountClaimAuditRequestContext(request: FastifyRequest): AccountClaimAuditRequestContext {
  return {
    sessionId: request.actor.sessionId,
    sourceIp: request.ip,
    transport: request.authTransport,
    userAgent: readHeaderValue(request.headers['user-agent']) ?? null,
  };
}
