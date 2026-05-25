import {
  buildFastifyResponseSchemas,
  compartmentInstallPathname,
  installRequestSchema,
  installResponseSchema,
  type InstallRequest,
  type InstallResponse,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { parseRequestValue } from '../../http/validation';
import { install } from '../../services/install.service';
import type { InstallResult, InstallServiceInput } from '../../services/install.service.types';
import { buildOperationSummary } from '../presenters/operation.presenter';

export function registerPostInstallRoute(app: ApiApp): void {
  app.post(
    compartmentInstallPathname,
    {
      schema: {
        response: buildFastifyResponseSchemas({
          200: installResponseSchema,
        }),
      },
    },
    handlePostInstall,
  );
}

async function handlePostInstall(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const result: InstallResult = await install(readInstallServiceInput(request));
  const response: InstallResponse = buildInstallResponse(result);

  return await reply.send(response);
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
