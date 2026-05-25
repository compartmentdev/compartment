import { createApiRateLimitRouteOptions } from '../../http/rate-limit';
import { apiRouteRateLimitPolicies } from '../../http/rate-limit-policies';
import type { ApiRateLimitRouteOptions } from '../../http/rate-limit.types';

export const gitSourcePublicRateLimitRouteOptions: ApiRateLimitRouteOptions = createApiRateLimitRouteOptions(
  apiRouteRateLimitPolicies.gitSourcePublic,
);

export const gitSourceWebhookRateLimitRouteOptions: ApiRateLimitRouteOptions = createApiRateLimitRouteOptions(
  apiRouteRateLimitPolicies.gitSourceWebhook,
);
