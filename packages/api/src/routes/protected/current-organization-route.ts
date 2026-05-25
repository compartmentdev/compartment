import {
  buildFastifyResponseSchemas,
  type FastifyResponseContractSchemas,
  type FastifyResponseSchemas,
  type PermissionKey,
} from '@compartment/contracts';
import type { FastifyRequest, RouteOptions } from 'fastify';
import type { ApiApp } from '../../app.types';
import type { CurrentOrganizationAccess } from '../../http/request.types';
import { createApiRateLimitRouteOptions } from '../../http/rate-limit';
import { apiRouteRateLimitPolicies } from '../../http/rate-limit-policies';
import type { ApiRateLimitRouteConfig, ApiRateLimitRouteSettings } from '../../http/rate-limit.types';
import { requireCurrentOrganizationAccess } from './authorize-request';

const currentOrganizationRateLimitRouteConfig: ApiRateLimitRouteConfig = createApiRateLimitRouteOptions(
  apiRouteRateLimitPolicies.currentOrganization,
).config;

export interface CurrentOrganizationRouteOptions {
  config: CurrentOrganizationRouteConfig;
  preHandler: CurrentOrganizationRoutePreHandler;
}

interface CurrentOrganizationResponseRouteOptions extends CurrentOrganizationRouteOptions {
  schema: CurrentOrganizationRouteSchema;
}

interface CurrentOrganizationRouteConfig {
  currentOrganizationAccessMode: 'membership' | 'permission';
  currentOrganizationPermission?: PermissionKey;
  rateLimit: ApiRateLimitRouteSettings;
}

interface CurrentOrganizationRouteSchema {
  response: FastifyResponseSchemas;
}

type CurrentOrganizationRoutePreHandler = (request: FastifyRequest) => Promise<void>;

export function createCurrentOrganizationRouteResponseOptions(
  currentOrganizationPermission: PermissionKey | undefined,
  responseSchemas: FastifyResponseContractSchemas,
): CurrentOrganizationResponseRouteOptions {
  return {
    ...createCurrentOrganizationRouteOptions(currentOrganizationPermission),
    schema: {
      response: buildFastifyResponseSchemas(responseSchemas),
    },
  };
}

export function createCurrentOrganizationRouteOptions(
  currentOrganizationPermission?: PermissionKey,
): CurrentOrganizationRouteOptions {
  return new CurrentOrganizationRouteOptionsRecord(currentOrganizationPermission);
}

export function registerCurrentOrganizationAccessHooks(app: ApiApp): void {
  app.addHook('onRoute', assertCurrentOrganizationRouteConfig);
}

async function authorizeCurrentOrganizationRequest(request: FastifyRequest): Promise<void> {
  const currentOrganization: CurrentOrganizationAccess = await requireCurrentOrganizationAccess(
    request,
    request.routeOptions.config.currentOrganizationPermission,
  );
  request.currentOrganization = currentOrganization;
}

function assertCurrentOrganizationRouteConfig(routeOptions: RouteOptions): void {
  if (routeOptions.config?.rateLimit !== undefined && routeOptions.config.currentOrganizationAccessMode === undefined) {
    throw new Error(
      `Current-organization route ${formatRouteSignature(routeOptions)} must declare config.currentOrganizationPermission.`,
    );
  }
}

function formatRouteSignature(routeOptions: RouteOptions): string {
  const method: string = Array.isArray(routeOptions.method) ? routeOptions.method.join(',') : routeOptions.method;
  return `${method} ${routeOptions.url}`;
}

class CurrentOrganizationRouteOptionsRecord implements CurrentOrganizationRouteOptions {
  readonly config: CurrentOrganizationRouteConfig;
  readonly preHandler: CurrentOrganizationRoutePreHandler = authorizeCurrentOrganizationRequest;

  constructor(currentOrganizationPermission?: PermissionKey) {
    this.config = {
      currentOrganizationAccessMode: currentOrganizationPermission === undefined ? 'membership' : 'permission',
      ...(currentOrganizationPermission === undefined ? {} : { currentOrganizationPermission }),
      rateLimit: currentOrganizationRateLimitRouteConfig.rateLimit,
    };
  }
}
