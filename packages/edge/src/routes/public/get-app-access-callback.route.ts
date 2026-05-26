import {
  appAccessExchangeRequestSchema,
  compartmentAppCallbackPathname,
  type AppAccessExchangeRequest,
  type AppAccessExchangeResponse,
} from '@compartment/contracts';
import { isSafeRelativePath, readSingleSearchParam } from '@compartment/utils';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { SafeParseReturnType } from 'zod';
import type { EdgeApp } from '../../app.types';
import type { EdgeConfig } from '../../config';
import type { EdgeAppAccessStateStore } from '../../services/app-access-state-store.service.types';
import { buildClearedAppFlowStateCookie, hasAppFlowStateCookie } from '../../services/edge-app-flow-cookie.service';
import { buildAppSessionCookie, exchangeAppAccessCodeWithApi } from '../../services/edge-gateway.service';
import { readAppHostOrReply } from './public-route-host.service';
import { setReplyCookies } from './public-route.utils';

export function registerGetAppAccessCallbackRoute(
  app: EdgeApp,
  config: EdgeConfig,
  store: EdgeAppAccessStateStore,
): void {
  app.get(
    compartmentAppCallbackPathname,
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
      return await handleAppAccessCallbackRequest(request, reply, config, store);
    },
  );
}

async function handleAppAccessCallbackRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  config: EdgeConfig,
  store: EdgeAppAccessStateStore,
): Promise<FastifyReply> {
  const host: string | null = await readAppHostOrReply(request, reply, config);
  if (host === null) {
    return await reply;
  }

  const callbackInput: AppAccessExchangeRequest | null = readCallbackRequestInput(request, host);
  if (callbackInput === null) {
    return await replyInvalidAppAccessCallback(reply);
  }
  if (!hasAppFlowStateCookie(request.headers.cookie, callbackInput.state)) {
    return await replyInvalidAppAccessCallback(reply);
  }

  return await replyWithAppAccessCallbackExchange(reply, config, store, callbackInput);
}

async function replyWithAppAccessCallbackExchange(
  reply: FastifyReply,
  config: EdgeConfig,
  store: EdgeAppAccessStateStore,
  callbackInput: AppAccessExchangeRequest,
): Promise<FastifyReply> {
  const response: AppAccessExchangeResponse = await exchangeAppAccessCodeWithApi(config, callbackInput);
  const redirectPath: string = requireSafeAppAccessCallbackRedirectPath(response.redirectPath);
  persistAppAccessCallbackResult(reply, store, callbackInput, response);

  return await reply.redirect(redirectPath);
}

function requireSafeAppAccessCallbackRedirectPath(redirectPath: string): string {
  if (isSafeRelativePath(redirectPath)) {
    return redirectPath;
  }

  throw new Error('App access callback redirect path must be a safe relative path.');
}

function persistAppAccessCallbackResult(
  reply: FastifyReply,
  store: EdgeAppAccessStateStore,
  callbackInput: AppAccessExchangeRequest,
  response: AppAccessExchangeResponse,
): void {
  store.setSession(response.appSessionToken, response.session);
  setReplyCookies(reply, [
    buildClearedAppFlowStateCookie(callbackInput.state),
    buildAppSessionCookie(response.appSessionToken, response.session.expiresAt),
  ]);
}

async function replyInvalidAppAccessCallback(reply: FastifyReply): Promise<FastifyReply> {
  return await reply.code(400).send({ error: 'invalid_request' });
}

function readCallbackRequestInput(request: FastifyRequest, host: string): AppAccessExchangeRequest | null {
  const callbackUrl: URL = new URL(request.url, `http://${host}`);
  const callbackCode: string | null = readSingleSearchParam(callbackUrl.searchParams, 'code');
  const callbackState: string | null = readSingleSearchParam(callbackUrl.searchParams, 'state');
  const parseResult: SafeParseReturnType<AppAccessExchangeRequest, AppAccessExchangeRequest> =
    appAccessExchangeRequestSchema.safeParse({
      code: callbackCode,
      host,
      state: callbackState,
    });
  if (!parseResult.success) {
    return null;
  }

  return parseResult.data;
}
