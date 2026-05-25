import type { ApiAuthThrottleConfig } from '../src/auth-throttle-config.types';

export const defaultApiAuthThrottleConfig: ApiAuthThrottleConfig = {
  activation: {
    route: {
      maxRequests: 10,
      windowMs: 60_000,
    },
    source: {
      blockMs: 30 * 60_000,
      maxFailures: 15,
      windowMs: 10 * 60_000,
    },
    sourceSubject: {
      blockMs: 30 * 60_000,
      maxFailures: 3,
      windowMs: 10 * 60_000,
    },
    subject: {
      blockMs: 60 * 60_000,
      maxFailures: 5,
      windowMs: 30 * 60_000,
    },
  },
  login: {
    account: {
      blockMs: 30 * 60_000,
      maxFailures: 10,
      windowMs: 10 * 60_000,
    },
    route: {
      maxRequests: 30,
      windowMs: 60_000,
    },
    source: {
      blockMs: 15 * 60_000,
      maxFailures: 20,
      windowMs: 5 * 60_000,
    },
    sourceAccount: {
      blockMs: 10 * 60_000,
      maxFailures: 5,
      windowMs: 60_000,
    },
  },
  resetPassword: {
    route: {
      maxRequests: 10,
      windowMs: 60_000,
    },
    source: {
      blockMs: 30 * 60_000,
      maxFailures: 15,
      windowMs: 10 * 60_000,
    },
    sourceSubject: {
      blockMs: 30 * 60_000,
      maxFailures: 3,
      windowMs: 10 * 60_000,
    },
    subject: {
      blockMs: 60 * 60_000,
      maxFailures: 5,
      windowMs: 30 * 60_000,
    },
  },
};
