import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ApiConfig } from '../src/config';
import type * as RuntimeAccess from '../src/runtime/runtime-access';
import {
  readGitHubAccountDiscoveryBrokerResult,
  startGitHubAccountDiscoveryBrokerSession,
} from '../src/services/git-source/github-account-discovery-broker.adapter';

type GetApiConfig = typeof RuntimeAccess.getApiConfig;
type FetchBrokerHttp = (path: string, init?: RequestInit) => Promise<Response>;

interface RuntimeAccessModule {
  getApiConfig: Mock<GetApiConfig>;
}

const mocks: {
  fetchGitHubAccountDiscoveryBrokerHttp: Mock<FetchBrokerHttp>;
  getApiConfig: Mock<GetApiConfig>;
} = vi.hoisted(
  (): {
    fetchGitHubAccountDiscoveryBrokerHttp: Mock<FetchBrokerHttp>;
    getApiConfig: Mock<GetApiConfig>;
  } => ({
    fetchGitHubAccountDiscoveryBrokerHttp: vi.fn<FetchBrokerHttp>(),
    getApiConfig: vi.fn<GetApiConfig>(),
  }),
);

vi.mock(
  '../src/runtime/runtime-access',
  (): RuntimeAccessModule => ({
    getApiConfig: mocks.getApiConfig,
  }),
);

vi.mock(
  '../src/services/outbound-http.service',
  (): { fetchGitHubAccountDiscoveryBrokerHttp: Mock<FetchBrokerHttp> } => ({
    fetchGitHubAccountDiscoveryBrokerHttp: mocks.fetchGitHubAccountDiscoveryBrokerHttp,
  }),
);

describe('GitHub account discovery broker adapter', (): void => {
  afterEach((): void => {
    vi.resetAllMocks();
  });

  it('starts broker discovery with canonical broker credentials', async (): Promise<void> => {
    mocks.getApiConfig.mockReturnValue(createApiConfig());
    const fetchMock: Mock<FetchBrokerHttp> = mocks.fetchGitHubAccountDiscoveryBrokerHttp.mockResolvedValueOnce(
      createJsonResponse({
        browserUrl: 'https://broker.example/github/start?session=gad_123',
        sessionId: 'gad_123',
      }),
    );

    await expect(
      startGitHubAccountDiscoveryBrokerSession({
        returnTo: 'https://console.example/sources/git/setup',
      }),
    ).resolves.toEqual({
      browserUrl: 'https://broker.example/github/start?session=gad_123',
      sessionId: 'gad_123',
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/v1/github/account-discovery/sessions');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      body: '{"returnTo":"https://console.example/sources/git/setup"}',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer broker-token',
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });
  });

  it('reads broker discovery results with encoded session and result tokens', async (): Promise<void> => {
    mocks.getApiConfig.mockReturnValue(createApiConfig());
    const fetchMock: Mock<FetchBrokerHttp> = mocks.fetchGitHubAccountDiscoveryBrokerHttp.mockResolvedValueOnce(
      createJsonResponse({
        accounts: [
          {
            avatarUrl: null,
            login: 'acme',
            type: 'organization',
          },
        ],
        user: {
          avatarUrl: null,
          login: 'admin',
          type: 'user',
        },
      }),
    );

    await readGitHubAccountDiscoveryBrokerResult({
      resultToken: 'result/123',
      sessionId: 'gad_123/unsafe',
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/v1/github/account-discovery/sessions/gad_123%2Funsafe/result?result_token=result%2F123',
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer broker-token',
      },
    });
  });

  it('fails broker responses by status before parsing the response body', async (): Promise<void> => {
    mocks.getApiConfig.mockReturnValue(createApiConfig());
    mocks.fetchGitHubAccountDiscoveryBrokerHttp.mockResolvedValueOnce(new Response('unauthorized', { status: 401 }));

    await expect(
      startGitHubAccountDiscoveryBrokerSession({
        returnTo: 'https://console.example/sources/git/setup',
      }),
    ).rejects.toMatchObject({
      code: 'git_source_registration_failed',
      message: 'GitHub account discovery broker failed with status 401.',
    });
  });

  it('fails when canonical broker config is disabled', async (): Promise<void> => {
    mocks.getApiConfig.mockReturnValue(
      createApiConfig({
        managedDomainBrokerToken: null,
        managedDomainBrokerUrl: null,
      }),
    );

    await expect(
      startGitHubAccountDiscoveryBrokerSession({
        returnTo: 'https://console.example/sources/git/setup',
      }),
    ).rejects.toMatchObject({
      code: 'git_source_registration_failed',
      message: 'GitHub account discovery is not configured for this install.',
    });
  });
});

function createJsonResponse(body: object): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json',
    },
    status: 200,
  });
}

function createApiConfig(overrides: Partial<ApiConfig> = {}): ApiConfig {
  return {
    managedDomainBrokerToken: 'broker-token',
    managedDomainBrokerUrl: 'https://broker.example/',
    tenantSecretsKek: Buffer.from('11'.repeat(32), 'hex'),
    variablesMasterKey: Buffer.from('11'.repeat(32), 'hex'),
    ...overrides,
  } as ApiConfig;
}
