import type { ApiRouteRateLimitPolicies } from './rate-limit.types';

const apiRateLimitOneMinuteMs: number = 60_000;
const apiRateLimitOneMinute: string = '1 minute';

export const apiRouteRateLimitPolicies: ApiRouteRateLimitPolicies = {
  authClaim: {
    bucketId: 'auth.claim',
    hook: 'preHandler',
    max: 5,
    timeWindow: apiRateLimitOneMinuteMs,
  },
  authCliLogin: {
    bucketId: 'auth.cli_login',
    hook: 'preHandler',
    max: 120,
    timeWindow: apiRateLimitOneMinuteMs,
  },
  authLoginDiscoverySource: {
    bucketId: 'auth.login_discovery.source',
    max: 30,
    timeWindow: apiRateLimitOneMinuteMs,
  },
  authLoginDiscoverySubject: {
    bucketId: 'auth.login_discovery.subject',
    max: 120,
    timeWindow: apiRateLimitOneMinuteMs,
  },
  authSignup: {
    bucketId: 'auth.signup',
    hook: 'preHandler',
    max: 5,
    timeWindow: apiRateLimitOneMinuteMs,
  },
  authState: {
    bucketId: 'auth.state',
    max: 30,
    timeWindow: apiRateLimitOneMinuteMs,
  },
  browserPage: {
    bucketId: 'browser.page',
    max: 60,
    timeWindow: apiRateLimitOneMinute,
  },
  currentOrganization: {
    bucketId: 'protected.current_organization',
    max: 600,
    timeWindow: apiRateLimitOneMinute,
  },
  gitSourcePublic: {
    bucketId: 'git_source.public',
    max: 30,
    timeWindow: apiRateLimitOneMinute,
  },
  gitSourceWebhook: {
    bucketId: 'git_source.webhook',
    max: 300,
    timeWindow: apiRateLimitOneMinute,
  },
  systemDomain: {
    bucketId: 'system.domain',
    max: 600,
    timeWindow: apiRateLimitOneMinute,
  },
  systemPasswordReset: {
    bucketId: 'system.password_reset',
    max: 600,
    timeWindow: apiRateLimitOneMinute,
  },
};
