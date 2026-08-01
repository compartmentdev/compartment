import {
  buildFastifyResponseSchemas,
  compartmentInstallPathname,
  installRequestSchema,
  installResponseSchema,
  type InstallRequest,
  type InstallResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { readHeaderValue } from '@compartment/utils';
import type { ApiApp } from '../../app.types';
import { requireExpectedBearerToken } from '../../http/headers';
import { parseRequestValue } from '../../http/validation';
import { install } from '../../services/install.service';
import { recordAuditEvent } from '../../services/audit-events.service';
import type { InstallResult, InstallServiceInput } from '../../services/install.service.types';
import { buildOperationSummary } from '../presenters/operation.presenter';

const installAuthenticationErrorCode: string = 'install_unauthorized';
const installAuthenticationErrorMessage: string = 'A valid install token is required.';

export function registerPostInstallRoute(app: ApiApp, installToken: string): void {
  // A high-entropy operator token authenticates this one-time route; a public rate limiter would not add protection.
  app.post(
    compartmentInstallPathname,
    {
      schema: {
        response: buildFastifyResponseSchemas({
          200: installResponseSchema,
        }),
      },
    },
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
      await handlePostInstall(request, reply, installToken),
  );
}

async function handlePostInstall(
  request: FastifyRequest,
  reply: FastifyReply,
  installToken: string,
): Promise<FastifyReply> {
  requireExpectedBearerToken(
    readHeaderValue(request.headers.authorization),
    installToken,
    installAuthenticationErrorCode,
    installAuthenticationErrorMessage,
  );
  const result: InstallResult = await install(readInstallServiceInput(request));
  await recordOwnerActivationAudit(request, result);
  const response: InstallResponse = buildInstallResponse(result);

  return await reply.send(response);
}

async function recordOwnerActivationAudit(request: FastifyRequest, result: InstallResult): Promise<void> {
  if (!result.createdOwner) {
    return;
  }
  await recordAuditEvent({
    actor: {
      email: result.adminEmail,
      principalId: result.principalId,
      sessionId: result.sessionId,
      sourceIp: request.ip,
      transport: 'install_token',
      type: 'user',
      userAgent: readHeaderValue(request.headers['user-agent']) ?? null,
    },
    eventType: 'installation.owner.activated',
    metadata: {},
    organizationId: result.organizationId,
    target: {
      displayName: result.adminEmail,
      id: result.principalId,
      type: 'principal',
    },
  });
}

function readInstallServiceInput(request: FastifyRequest): InstallServiceInput {
  const requestBody: InstallRequest = parseRequestValue(installRequestSchema, request.body, 'invalid_install_request');

  return {
    adminEmail: requestBody.adminEmail,
    adminPassword: requestBody.adminPassword,
    baseDomain: requestBody.baseDomain,
    organizationName: requestBody.organizationName,
    organizationSlug: requestBody.organizationSlug,
  };
}

function buildInstallResponse(result: InstallResult): InstallResponse {
  return installResponseSchema.parse({
    adminEmail: result.adminEmail,
    baseDomain: result.baseDomain,
    dnsRecords: result.dnsRecords,
    operation: buildOperationSummary(result.operation),
    organization: {
      id: result.organizationId,
      name: result.organizationName,
      slug: result.organizationSlug,
    },
    compartmentUrl: result.compartmentUrl,
    sessionToken: result.sessionToken,
  });
}
