import { compartmentOnDemandTlsAskPathname } from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { EdgeApp } from '../app.types';
import { getEdgeConfig } from '../runtime/runtime-access';
import type { EdgeAppAccessStateStore } from '../services/app-access-state-store.service.types';

interface OnDemandTlsAskQuery {
  domain?: string | undefined;
}

export function registerGetOnDemandTlsAskRoute(app: EdgeApp, store: EdgeAppAccessStateStore): void {
  app.get(
    compartmentOnDemandTlsAskPathname,
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      if (!isInternalOnDemandTlsAskRequest(request)) {
        return await reply.code(404).send({ error: 'not_found' });
      }

      const host: string | null = readOnDemandTlsAskHost(request.query as OnDemandTlsAskQuery);
      if (host === null || !store.hasOnDemandTlsHost(host)) {
        return await reply.code(404).send({ error: 'domain_not_allowed' });
      }

      return await reply.code(200).send();
    },
  );
}

function isInternalOnDemandTlsAskRequest(request: FastifyRequest): boolean {
  return request.hostname === getEdgeConfig().internalHost;
}

function readOnDemandTlsAskHost(query: OnDemandTlsAskQuery | null): string | null {
  const rawDomain: string | undefined = query?.domain;
  if (typeof rawDomain !== 'string') {
    return null;
  }
  const host: string = rawDomain.trim().replace(/\.$/u, '').toLowerCase();

  return host === '' ? null : host;
}
