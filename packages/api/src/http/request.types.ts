import type { AuditEventType, PermissionKey } from '@compartment/contracts';
import type { Actor } from '../services/auth-actor.types';

type RequestAuthTransport = 'bearer' | 'browser_cookie';

export interface CurrentOrganizationAccess {
  id: string;
  slug: string;
}

declare module 'fastify' {
  interface FastifyContextConfig {
    currentOrganizationAccessMode?: 'membership' | 'permission';
    currentOrganizationPermission?: PermissionKey;
    failedAuditEventType?: AuditEventType;
  }

  interface FastifyRequest {
    actor: Actor;
    authTransport: RequestAuthTransport;
    currentOrganization: CurrentOrganizationAccess;
    rawBody?: Buffer | undefined;
  }
}
