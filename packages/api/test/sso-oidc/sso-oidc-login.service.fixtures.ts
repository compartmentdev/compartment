import type { ApiConfig } from '../../src/config';
import { createApiTestConfig } from '../api-config-test.fixtures';

export function createSsoOidcApiConfig(): ApiConfig {
  return createApiTestConfig({
    controlPlaneHost: 'compartment.localhost',
    publicHttpPort: 80,
    publicProtocol: 'https',
    sessionTtlMs: 3_600_000,
  });
}
