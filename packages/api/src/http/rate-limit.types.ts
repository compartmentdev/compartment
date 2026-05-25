import type { FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';

export interface ApiRateLimitPolicy {
  bucketId: string;
  hook?: ApiRateLimitHook;
  max: number;
  timeWindow: number | string;
}

export interface ApiRouteRateLimitPolicies {
  authCliLogin: ApiRateLimitPolicy;
  authLoginDiscoverySource: ApiRateLimitPolicy;
  authLoginDiscoverySubject: ApiRateLimitPolicy;
  authState: ApiRateLimitPolicy;
  browserPage: ApiRateLimitPolicy;
  currentOrganization: ApiRateLimitPolicy;
  gitSourcePublic: ApiRateLimitPolicy;
  gitSourceWebhook: ApiRateLimitPolicy;
  systemDomain: ApiRateLimitPolicy;
  systemPasswordReset: ApiRateLimitPolicy;
}

export type ApiRateLimitKeyGenerator = (request: FastifyRequest) => number | string | Promise<number | string>;
export type ApiRateLimitHook = 'onRequest' | 'preParsing' | 'preValidation' | 'preHandler';
export type ApiRateLimitPreHandler = preHandlerAsyncHookHandler;
export type ApiRateLimitRunner = (request: FastifyRequest) => Promise<ApiRateLimitResult>;

export type ApiRateLimitResult = ApiRateLimitAllowedResult | ApiRateLimitBlockedResult;

export interface ApiRateLimitAllowedResult {
  isAllowed: true;
  key: string;
}

export interface ApiRateLimitBlockedResult {
  isAllowed: false;
  isBanned: boolean;
  isExceeded: boolean;
  key: string;
  max: number;
  remaining: number;
  timeWindow: number;
  ttl: number;
  ttlInSeconds: number;
}

export interface ApiRateLimitRouteOptions {
  config: ApiRateLimitRouteConfig;
}

export interface ApiRateLimitRouteConfig {
  rateLimit: ApiRateLimitRouteSettings;
}

export interface ApiRateLimitRouteSettings {
  hook?: ApiRateLimitHook;
  keyGenerator: ApiRateLimitKeyGenerator;
  max: number;
  timeWindow: number | string;
}

export interface ApiRateLimitBucket {
  keyGenerator?: ApiRateLimitKeyGenerator | undefined;
  policy: ApiRateLimitPolicy;
}

export interface ApiMultiRateLimitRouteOptions {
  preHandler: ApiRateLimitPreHandler;
}
