import {
  buildFastifyResponseSchemas,
  compartmentSystemDomainActivatePathname,
  compartmentSystemDomainAttachCertificatePathname,
  compartmentSystemDomainResetManagedPathname,
  compartmentSystemDomainSetPathname,
  compartmentSystemDomainStatusPathname,
  compartmentSystemDomainStatusRefreshPathname,
  compartmentSystemDomainVerifyPathname,
  type FastifyResponseSchemas,
  systemDomainMutationResponseSchema,
  systemDomainAttachCertificateRequestSchema,
  systemDomainSetRequestSchema,
  systemDomainStatusResponseSchema,
  systemDomainVersionedRequestSchema,
  type SystemDomainAttachCertificateRequest,
  type SystemDomainSetRequest,
  type SystemDomainVersionedRequest,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { createApiRateLimitRouteOptions } from '../../http/rate-limit';
import { apiRouteRateLimitPolicies } from '../../http/rate-limit-policies';
import type { ApiRateLimitRouteOptions } from '../../http/rate-limit.types';
import { parseRequestValue } from '../../http/validation';
import { activateSystemDomainPending, verifySystemDomainPending } from '../../services/system-domain-operation.service';
import { resetSystemDomainManaged } from '../../services/system-domain-managed-reset.service';
import { attachSystemDomainPendingCertificate } from '../../services/system-domain-certificate-operation.service';
import { refreshSystemDomainStatus } from '../../services/system-domain-health.service';
import { readSystemDomainStatus, stageSystemDomain } from '../../services/system-domain.service';
import type {
  SystemDomainMutationResult,
  SystemDomainStatusResult,
  VersionedSystemDomainMutationInput,
} from '../../services/system-domain.service.types';
import { authenticateSystemRequest } from './authenticate-system-request';
import { readRequiredIdempotencyKey } from './system-domain.route.helpers';
import { buildSystemDomainMutationResponse, buildSystemDomainStatusResponse } from './system-domain.presenter';

const systemDomainRateLimitedRouteOptions: ApiRateLimitRouteOptions = createApiRateLimitRouteOptions(
  apiRouteRateLimitPolicies.systemDomain,
);
const systemDomainStatusRouteOptions: SystemDomainResponseRouteOptions = {
  ...systemDomainRateLimitedRouteOptions,
  schema: {
    response: buildFastifyResponseSchemas({
      200: systemDomainStatusResponseSchema,
    }),
  },
};
const systemDomainMutationRouteOptions: SystemDomainResponseRouteOptions = {
  ...systemDomainRateLimitedRouteOptions,
  schema: {
    response: buildFastifyResponseSchemas({
      200: systemDomainMutationResponseSchema,
    }),
  },
};

interface SystemDomainResponseRouteSchema {
  response: FastifyResponseSchemas;
}

interface SystemDomainResponseRouteOptions extends ApiRateLimitRouteOptions {
  schema: SystemDomainResponseRouteSchema;
}

interface SystemDomainVersionedMutationRoute {
  invalidRequestCode: string;
  mutate: SystemDomainVersionedMutation;
  path: string;
}

type SystemDomainVersionedMutation = (input: VersionedSystemDomainMutationInput) => Promise<SystemDomainMutationResult>;

const systemDomainVersionedMutationRoutes: readonly SystemDomainVersionedMutationRoute[] = [
  {
    invalidRequestCode: 'invalid_system_domain_verify_request',
    mutate: verifySystemDomainPending,
    path: compartmentSystemDomainVerifyPathname,
  },
  {
    invalidRequestCode: 'invalid_system_domain_activate_request',
    mutate: activateSystemDomainPending,
    path: compartmentSystemDomainActivatePathname,
  },
  {
    invalidRequestCode: 'invalid_system_domain_reset_managed_request',
    mutate: resetSystemDomainManaged,
    path: compartmentSystemDomainResetManagedPathname,
  },
];

export function registerSystemDomainRoutes(app: ApiApp): void {
  app.after((): void => {
    app.addHook('preHandler', authenticateSystemRequest);
    registerSystemDomainStatusRoute(app);
    registerSystemDomainStatusRefreshRoute(app);
    registerSystemDomainSetRoute(app);
    registerSystemDomainAttachCertificateRoute(app);
    registerSystemDomainVersionedMutationRoutes(app);
  });
}

function registerSystemDomainStatusRoute(app: ApiApp): void {
  app.get(compartmentSystemDomainStatusPathname, systemDomainStatusRouteOptions, handleSystemDomainStatusRequest);
}

function registerSystemDomainStatusRefreshRoute(app: ApiApp): void {
  app.post(
    compartmentSystemDomainStatusRefreshPathname,
    systemDomainStatusRouteOptions,
    handleSystemDomainStatusRefreshRequest,
  );
}

function registerSystemDomainSetRoute(app: ApiApp): void {
  app.post(compartmentSystemDomainSetPathname, systemDomainMutationRouteOptions, handleSystemDomainSetRequest);
}

function registerSystemDomainAttachCertificateRoute(app: ApiApp): void {
  app.post(
    compartmentSystemDomainAttachCertificatePathname,
    systemDomainMutationRouteOptions,
    handleSystemDomainAttachCertificateRequest,
  );
}

function registerSystemDomainVersionedMutationRoutes(app: ApiApp): void {
  for (const route of systemDomainVersionedMutationRoutes) {
    app.post(
      route.path,
      systemDomainMutationRouteOptions,
      async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
        await handleSystemDomainVersionedMutationRequest(request, reply, route),
    );
  }
}

async function handleSystemDomainStatusRequest(_request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const result: SystemDomainStatusResult = await readSystemDomainStatus();

  return await reply.send(buildSystemDomainStatusResponse(result));
}

async function handleSystemDomainStatusRefreshRequest(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const result: SystemDomainStatusResult = await refreshSystemDomainStatus();

  return await reply.send(buildSystemDomainStatusResponse(result));
}

async function handleSystemDomainSetRequest(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const requestBody: SystemDomainSetRequest = parseRequestValue(
    systemDomainSetRequestSchema,
    request.body,
    'invalid_system_domain_set_request',
  );
  const result: SystemDomainMutationResult = await stageSystemDomain({
    expectedSetupVersion: requestBody.expectedSetupVersion,
    hostPlan: requestBody.hostPlan,
    idempotencyKey: readRequiredIdempotencyKey(request),
  });

  return await reply.send(buildSystemDomainMutationResponse(result));
}

async function handleSystemDomainAttachCertificateRequest(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const requestBody: SystemDomainAttachCertificateRequest = parseRequestValue(
    systemDomainAttachCertificateRequestSchema,
    request.body,
    'invalid_system_domain_attach_certificate_request',
  );
  const result: SystemDomainMutationResult = await attachSystemDomainPendingCertificate({
    expectedSetupVersion: requestBody.expectedSetupVersion,
    idempotencyKey: readRequiredIdempotencyKey(request),
  });

  return await reply.send(buildSystemDomainMutationResponse(result));
}

async function handleSystemDomainVersionedMutationRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  route: SystemDomainVersionedMutationRoute,
): Promise<FastifyReply> {
  const requestBody: SystemDomainVersionedRequest = readVersionedRequest(request, route.invalidRequestCode);
  const result: SystemDomainMutationResult = await route.mutate({
    expectedSetupVersion: requestBody.expectedSetupVersion,
    idempotencyKey: readRequiredIdempotencyKey(request),
  });

  return await reply.send(buildSystemDomainMutationResponse(result));
}

function readVersionedRequest(request: FastifyRequest, code: string): SystemDomainVersionedRequest {
  return parseRequestValue(systemDomainVersionedRequestSchema, request.body, code);
}
