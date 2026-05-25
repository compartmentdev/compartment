import { compartmentAppLogoutPathname } from '@compartment/contracts';
import { parseHttpHostAuthority, readUrlOrigin } from '@compartment/utils';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { EdgeApp } from '../../app.types';
import type { EdgeConfig } from '../../config';
import type { EdgeAppAccessStateStore } from '../../services/app-access-state-store.service.types';
import {
  buildClearedAppSessionCookie,
  logoutAppAccessWithApi,
  readAppSessionToken,
} from '../../services/edge-gateway.service';
import { readAppHostOrReply } from './public-route-host.service';
import { readHeaderValue } from './public-route.utils';

export function registerPostAppAccessLogoutRoute(
  app: EdgeApp,
  config: EdgeConfig,
  store: EdgeAppAccessStateStore,
): void {
  app.post(
    compartmentAppLogoutPathname,
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      return await handleAppAccessLogoutRequest(request, reply, config, store);
    },
  );
}

async function handleAppAccessLogoutRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  config: EdgeConfig,
  store: EdgeAppAccessStateStore,
): Promise<FastifyReply> {
  const host: string | null = await readAppHostOrReply(request, reply, config);
  if (host === null) {
    return await reply;
  }

  if (!isSameOriginAppLogoutRequest(request, config)) {
    return await reply.code(403).send({ error: 'invalid_browser_request' });
  }

  const appSessionToken: string | null = readAppSessionToken(request.headers.cookie);
  clearLocalAppSession(store, appSessionToken);
  reply.header('Set-Cookie', buildClearedAppSessionCookie());
  await logoutAppAccessWithApi(config, appSessionToken);

  return await reply.redirect('/');
}

function clearLocalAppSession(store: EdgeAppAccessStateStore, appSessionToken: string | null): void {
  if (appSessionToken !== null) {
    store.clearSession(appSessionToken);
  }
}

function isSameOriginAppLogoutRequest(request: FastifyRequest, config: EdgeConfig): boolean {
  const requestAuthority: string | null = readRequestAuthority(request.headers.host);
  if (requestAuthority === null) {
    return false;
  }

  const expectedOrigin: string | null = readUrlOrigin(`${config.publicProtocol}://${requestAuthority}`);
  if (expectedOrigin === null) {
    return false;
  }
  const origin: string | null = readUrlOrigin(readHeaderValue(request.headers.origin));
  if (origin !== null) {
    return origin === expectedOrigin;
  }

  return readUrlOrigin(readHeaderValue(request.headers.referer)) === expectedOrigin;
}

function readRequestAuthority(hostHeader: string | string[] | undefined): string | null {
  const value: string | undefined = readHeaderValue(hostHeader);
  return parseHttpHostAuthority(value)?.authority ?? null;
}
