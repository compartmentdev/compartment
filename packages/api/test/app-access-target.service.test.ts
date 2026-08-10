import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { type ApiConfig } from '../src/config';
import type { getApiConfig } from '../src/runtime/runtime';
import { buildAppCallbackUrl, requireKnownBrowserFlowTarget } from '../src/services/app-access-target.service';
import { createApiTestConfig } from './api-config-test.fixtures';

type GetApiConfig = typeof getApiConfig;

interface AppAccessTargetServiceMocks {
  getApiConfig: Mock<GetApiConfig>;
}

interface RuntimeMockModule {
  getApiConfig: Mock<GetApiConfig>;
}

const mocks: AppAccessTargetServiceMocks = vi.hoisted(
  (): AppAccessTargetServiceMocks => ({
    getApiConfig: vi.fn<GetApiConfig>(),
  }),
);

vi.mock(
  '../src/runtime/runtime',
  (): RuntimeMockModule => ({
    getApiConfig: mocks.getApiConfig,
  }),
);

const apiConfig: ApiConfig = createApiTestConfig();

describe('app access target service', (): void => {
  beforeEach((): void => {
    mocks.getApiConfig.mockReturnValue(apiConfig);
  });

  it('rejects protocol-relative browser flow paths', async (): Promise<void> => {
    await expect(
      requireKnownBrowserFlowTarget({
        host: 'billing.localhost',
        path: '//attacker.example',
        state: 'flow',
      }),
    ).rejects.toMatchObject({
      code: 'invalid_browser_flow',
    });
  });

  it('rejects traversal browser flow paths', async (): Promise<void> => {
    await expect(
      requireKnownBrowserFlowTarget({
        host: 'billing.localhost',
        path: '/app%5c..%5cadmin',
        state: 'flow',
      }),
    ).rejects.toMatchObject({
      code: 'invalid_browser_flow',
    });
  });

  it('builds app callback URLs on the configured public localhost port', (): void => {
    mocks.getApiConfig.mockReturnValue({
      ...apiConfig,
      publicHttpPort: 38080,
    });

    expect(buildAppCallbackUrl('billing.localhost', 'code_123', 'flow')).toBe(
      'http://billing.localhost:38080/_compartment/callback?code=code_123&state=flow',
    );
  });

  it('builds app callback URLs on verified custom hosts', (): void => {
    mocks.getApiConfig.mockReturnValue({
      ...apiConfig,
      publicHttpPort: 38080,
    });

    expect(buildAppCallbackUrl('app.customer.example.com', 'code_123', 'flow')).toBe(
      'http://app.customer.example.com:38080/_compartment/callback?code=code_123&state=flow',
    );
  });
});
