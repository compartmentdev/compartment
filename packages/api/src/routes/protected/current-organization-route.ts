import {
  buildFastifyResponseSchemas,
  type FastifyResponseContractSchemas,
  type FastifyResponseSchemas,
  type AuditEventType,
  type PermissionKey,
} from '@compartment/contracts';
import type { FastifyRequest, RouteOptions } from 'fastify';
import type { ApiApp } from '../../app.types';
import { isApiBusinessError } from '../../errors/api-business-error';
import type { CurrentOrganizationAccess } from '../../http/request.types';
import { createApiRateLimitRouteOptions } from '../../http/rate-limit';
import { apiRouteRateLimitPolicies } from '../../http/rate-limit-policies';
import type { ApiRateLimitRouteConfig, ApiRateLimitRouteSettings } from '../../http/rate-limit.types';
import { recordAuditEvent } from '../../services/audit-events.service';
import { buildAuditEventForRequest } from '../audit/audit-event-route-context';
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
  failedAuditEventType?: AuditEventType;
  rateLimit: ApiRateLimitRouteSettings;
}

interface CurrentOrganizationRouteSchema {
  response: FastifyResponseSchemas;
}

type CurrentOrganizationRoutePreHandler = (request: FastifyRequest) => Promise<void>;

export function createCurrentOrganizationRouteResponseOptions(
  currentOrganizationPermission: PermissionKey | undefined,
  responseSchemas: FastifyResponseContractSchemas,
  failedAuditEventType?: AuditEventType,
): CurrentOrganizationResponseRouteOptions {
  return {
    ...createCurrentOrganizationRouteOptions(currentOrganizationPermission, failedAuditEventType),
    schema: {
      response: buildFastifyResponseSchemas(responseSchemas),
    },
  };
}

export function createCurrentOrganizationRouteOptions(
  currentOrganizationPermission?: PermissionKey,
  failedAuditEventType?: AuditEventType,
): CurrentOrganizationRouteOptions {
  return new CurrentOrganizationRouteOptionsRecord(currentOrganizationPermission, failedAuditEventType);
}

export function registerCurrentOrganizationAccessHooks(app: ApiApp): void {
  app.addHook('onRoute', assertCurrentOrganizationRouteConfig);
}

async function authorizeCurrentOrganizationRequest(request: FastifyRequest): Promise<void> {
  try {
    const currentOrganization: CurrentOrganizationAccess = await requireCurrentOrganizationAccess(
      request,
      request.routeOptions.config.currentOrganizationPermission,
    );
    request.currentOrganization = currentOrganization;
  } catch (error) {
    await auditPermissionDenial(request, error instanceof Error ? error : null);
    throw error;
  }
}

async function auditPermissionDenial(request: FastifyRequest, error: Error | null): Promise<void> {
  const permission: PermissionKey | undefined = request.routeOptions.config.currentOrganizationPermission;
  if (permission === undefined || !shouldAuditPermissionDenial(request, error)) {
    return;
  }
  const routeUrl: string = request.routeOptions.url ?? request.url;
  try {
    await recordAuditEvent(
      buildAuditEventForRequest(request, {
        eventType: 'authorization.denied',
        metadata: { method: request.method, permission },
        status: 'failed',
        target: {
          displayName: routeUrl,
          id: routeUrl,
          type: 'route',
        },
      }),
    );
  } catch (auditError) {
    request.log.error({ err: auditError }, 'Failed to record permission denial audit event.');
  }
}

function shouldAuditPermissionDenial(request: FastifyRequest, error: Error | null): boolean {
  return (
    request.routeOptions.config.failedAuditEventType === undefined &&
    isApiBusinessError(error) &&
    error.code === 'forbidden'
  );
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

  constructor(currentOrganizationPermission?: PermissionKey, failedAuditEventType?: AuditEventType) {
    this.config = {
      currentOrganizationAccessMode: currentOrganizationPermission === undefined ? 'membership' : 'permission',
      ...(currentOrganizationPermission === undefined ? {} : { currentOrganizationPermission }),
      ...(failedAuditEventType === undefined ? {} : { failedAuditEventType }),
      rateLimit: currentOrganizationRateLimitRouteConfig.rateLimit,
    };
  }
}
