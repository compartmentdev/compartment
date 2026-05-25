import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { startGitHubAccountDiscoveryBrokerSession } from '../src/services/git-source/github-account-discovery-broker.adapter';
import { startGitHubAccountDiscovery } from '../src/services/git-source/github-account-discovery.service';

type StartGitHubAccountDiscoveryBrokerSession = typeof startGitHubAccountDiscoveryBrokerSession;

interface GitHubAccountDiscoveryBrokerAdapterModule {
  startGitHubAccountDiscoveryBrokerSession: Mock<StartGitHubAccountDiscoveryBrokerSession>;
}

interface RuntimeAccessModule {
  getApiConfig: () => object;
}

interface TestRuntimePublicSettings {
  baseDomain: string;
  compartmentUrl: string;
}

interface PublicHostsServiceModule {
  buildRuntimePublicSettings: () => TestRuntimePublicSettings;
}

const mocks: {
  startGitHubAccountDiscoveryBrokerSession: Mock<StartGitHubAccountDiscoveryBrokerSession>;
} = vi.hoisted(
  (): {
    startGitHubAccountDiscoveryBrokerSession: Mock<StartGitHubAccountDiscoveryBrokerSession>;
  } => ({
    startGitHubAccountDiscoveryBrokerSession: vi.fn<StartGitHubAccountDiscoveryBrokerSession>(),
  }),
);

vi.mock(
  '../src/services/git-source/github-account-discovery-broker.adapter',
  (): GitHubAccountDiscoveryBrokerAdapterModule => ({
    startGitHubAccountDiscoveryBrokerSession: mocks.startGitHubAccountDiscoveryBrokerSession,
  }),
);

vi.mock(
  '../src/runtime/runtime-access',
  (): RuntimeAccessModule => ({
    getApiConfig: (): object => ({}),
  }),
);

vi.mock(
  '../src/services/public-hosts.service',
  (): PublicHostsServiceModule => ({
    buildRuntimePublicSettings: (): TestRuntimePublicSettings => ({
      baseDomain: 'example.com',
      compartmentUrl: 'https://console.example.com',
    }),
  }),
);

describe('GitHub account discovery service', (): void => {
  afterEach((): void => {
    vi.resetAllMocks();
  });

  it('rejects broker discovery return URLs outside this install origin', async (): Promise<void> => {
    await expect(
      startGitHubAccountDiscovery({
        returnTo: 'https://evil.example.com/sources/git/setup',
      }),
    ).rejects.toMatchObject({
      code: 'git_source_registration_failed',
    });

    expect(mocks.startGitHubAccountDiscoveryBrokerSession).not.toHaveBeenCalled();
  });
});
