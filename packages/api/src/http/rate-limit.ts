import fastifyRateLimit from '@fastify/rate-limit';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../app.types';
import { ApiBoundaryError } from '../errors/api-boundary-error';
import type {
  ApiMultiRateLimitRouteOptions,
  ApiRateLimitBucket,
  ApiRateLimitBlockedResult,
  ApiRateLimitHook,
  ApiRateLimitKeyGenerator,
  ApiRateLimitPolicy,
  ApiRateLimitPreHandler,
  ApiRateLimitResult,
  ApiRateLimitRouteConfig,
  ApiRateLimitRouteOptions,
  ApiRateLimitRouteSettings,
  ApiRateLimitRunner,
} from './rate-limit.types';

const apiRateLimitCacheSize: number = 10_000;
const apiRateLimitExceededCode: string = 'api_rate_limit_exceeded';
const apiRateLimitExceededMessage: string = 'API rate limit exceeded. Try again later.';
const apiRateLimitLimitHeaderName: string = 'x-ratelimit-limit';
const apiRateLimitRemainingHeaderName: string = 'x-ratelimit-remaining';
const apiRateLimitResetHeaderName: string = 'x-ratelimit-reset';
const apiRateLimitRetryAfterHeaderName: string = 'retry-after';

export function registerApiRateLimit(app: ApiApp): void {
  app.register(fastifyRateLimit, {
    cache: apiRateLimitCacheSize,
    errorResponseBuilder: createApiRateLimitError,
    global: false,
    keyGenerator: readApiRateLimitKey,
  });
}

export function createApiRateLimitRouteOptions(
  policy: ApiRateLimitPolicy,
  keyGenerator: ApiRateLimitKeyGenerator = readApiRateLimitKey,
): ApiRateLimitRouteOptions {
  return new ApiRateLimitRouteOptionsRecord(policy, keyGenerator);
}

export function createApiMultiRateLimitRouteOptions(
  app: ApiApp,
  buckets: readonly ApiRateLimitBucket[],
): ApiMultiRateLimitRouteOptions {
  const limiters: ApiRateLimitRunner[] = buckets.map(
    (bucket: ApiRateLimitBucket): ApiRateLimitRunner =>
      app.createRateLimit(buildApiRateLimitRouteSettings(bucket.policy, bucket.keyGenerator ?? readApiRateLimitKey)),
  );

  return new ApiMultiRateLimitRouteOptionsRecord(limiters);
}

function readApiRateLimitKey(request: FastifyRequest): string {
  return request.ip;
}

function buildApiRateLimitBucketKey(policy: ApiRateLimitPolicy, key: number | string): string {
  return `${policy.bucketId}:${key.toString()}`;
}

function createApiRateLimitError(): ApiBoundaryError {
  return new ApiBoundaryError(429, apiRateLimitExceededCode, apiRateLimitExceededMessage);
}

function buildApiRateLimitRouteSettings(
  policy: ApiRateLimitPolicy,
  keyGenerator: ApiRateLimitKeyGenerator,
): ApiRateLimitRouteSettings {
  return new ApiRateLimitRouteSettingsRecord(policy, keyGenerator);
}

class ApiRateLimitRouteOptionsRecord implements ApiRateLimitRouteOptions {
  readonly config: ApiRateLimitRouteConfig;

  constructor(policy: ApiRateLimitPolicy, keyGenerator: ApiRateLimitKeyGenerator) {
    this.config = new ApiRateLimitRouteConfigRecord(policy, keyGenerator);
  }
}

class ApiRateLimitRouteConfigRecord implements ApiRateLimitRouteConfig {
  readonly rateLimit: ApiRateLimitRouteSettings;

  constructor(policy: ApiRateLimitPolicy, keyGenerator: ApiRateLimitKeyGenerator) {
    this.rateLimit = new ApiRateLimitRouteSettingsRecord(policy, keyGenerator);
  }
}

class ApiRateLimitRouteSettingsRecord implements ApiRateLimitRouteSettings {
  declare readonly hook?: ApiRateLimitHook;
  readonly keyGenerator: ApiRateLimitKeyGenerator;
  readonly max: number;
  readonly timeWindow: number | string;

  constructor(policy: ApiRateLimitPolicy, keyGenerator: ApiRateLimitKeyGenerator) {
    if (policy.hook !== undefined) {
      this.hook = policy.hook;
    }
    this.keyGenerator = async (request: FastifyRequest): Promise<string> =>
      buildApiRateLimitBucketKey(policy, await keyGenerator(request));
    this.max = policy.max;
    this.timeWindow = policy.timeWindow;
  }
}

class ApiMultiRateLimitRouteOptionsRecord implements ApiMultiRateLimitRouteOptions {
  readonly preHandler: ApiRateLimitPreHandler;

  constructor(limiters: readonly ApiRateLimitRunner[]) {
    this.preHandler = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      let mostConstrainedResult: ApiRateLimitBlockedResult | null = null;
      for (const limiter of limiters) {
        const result: ApiRateLimitResult = await limiter(request);
        if (result.isAllowed) {
          continue;
        }
        if (result.isExceeded || result.isBanned) {
          setApiRateLimitHeaders(reply, result, true);
          throw createApiRateLimitError();
        }
        mostConstrainedResult = readMostConstrainedRateLimitResult(mostConstrainedResult, result);
      }

      if (mostConstrainedResult !== null) {
        setApiRateLimitHeaders(reply, mostConstrainedResult, false);
      }
    };
  }
}

function readMostConstrainedRateLimitResult(
  currentResult: ApiRateLimitBlockedResult | null,
  nextResult: ApiRateLimitBlockedResult,
): ApiRateLimitBlockedResult {
  if (currentResult === null) {
    return nextResult;
  }
  if (nextResult.remaining < currentResult.remaining) {
    return nextResult;
  }
  if (nextResult.remaining === currentResult.remaining && nextResult.ttlInSeconds < currentResult.ttlInSeconds) {
    return nextResult;
  }

  return currentResult;
}

function setApiRateLimitHeaders(
  reply: FastifyReply,
  result: ApiRateLimitBlockedResult,
  includeRetryAfter: boolean,
): void {
  reply.header(apiRateLimitLimitHeaderName, result.max);
  reply.header(apiRateLimitRemainingHeaderName, includeRetryAfter ? 0 : result.remaining);
  reply.header(apiRateLimitResetHeaderName, result.ttlInSeconds);
  if (includeRetryAfter) {
    reply.header(apiRateLimitRetryAfterHeaderName, result.ttlInSeconds);
  }
}
