import type { observeApiHttpRequest } from '../src/services/platform-metrics.service';

export interface ApiRequestMetricsServiceMock {
  observeApiHttpRequest: typeof observeApiHttpRequest;
}
