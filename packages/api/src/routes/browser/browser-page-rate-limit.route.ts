import { createApiRateLimitRouteOptions } from '../../http/rate-limit';
import { apiRouteRateLimitPolicies } from '../../http/rate-limit-policies';
import type { ApiRateLimitRouteOptions } from '../../http/rate-limit.types';

export const browserPageRateLimitRouteOptions: ApiRateLimitRouteOptions = createApiRateLimitRouteOptions(
  apiRouteRateLimitPolicies.browserPage,
);
