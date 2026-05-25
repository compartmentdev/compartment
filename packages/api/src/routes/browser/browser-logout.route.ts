import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { browserLogoutPathname } from '../../browser-public-paths';
import { authRateLimitRouteOptions } from '../auth/auth-rate-limit.route';
import { buildBrowserLoginGetUrl } from './browser-auth-get-url.helpers';

export function registerBrowserLogoutRoute(app: ApiApp): void {
  app.get(browserLogoutPathname, authRateLimitRouteOptions, handleBrowserLogoutGet);
}

async function handleBrowserLogoutGet(_request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  return await reply.redirect(buildBrowserLoginGetUrl({ autoRedirect: false }));
}
