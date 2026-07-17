import type { Dispatch, SetStateAction } from 'react';
import type { GitHubProviderBootstrapRequest, GitHubProviderBootstrapResponse } from '@compartment/contracts/browser';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  readAccountSelectedHandler,
  type GitHubAccountInstallStatus,
} from '../src/features/onboarding/onboarding-git-connect-actions';

type StartBootstrap = (
  organizationSlug: string,
  body: GitHubProviderBootstrapRequest,
) => Promise<GitHubProviderBootstrapResponse>;

interface GitApiMocks {
  startBrowserGitHubProviderBootstrap: Mock<StartBootstrap>;
}

interface WindowLocationStub {
  assign: Mock<(url: string) => void>;
  href: string;
}

interface WindowStub {
  location: WindowLocationStub;
}

const gitApiMocks: GitApiMocks = vi.hoisted(
  (): GitApiMocks => ({ startBrowserGitHubProviderBootstrap: vi.fn<StartBootstrap>() }),
);

vi.mock('../src/features/onboarding/onboarding-git-api', (): GitApiMocks => gitApiMocks);

describe('browser onboarding Git account selection', (): void => {
  afterEach((): void => {
    vi.unstubAllGlobals();
  });

  it('bootstraps the selected account and continues directly when its installation is active', async (): Promise<void> => {
    const assign: Mock<(url: string) => void> = vi.fn<(url: string) => void>();
    const windowStub: WindowStub = { location: { assign, href: 'https://console.example.com/onboarding' } };
    vi.stubGlobal('window', windowStub);
    gitApiMocks.startBrowserGitHubProviderBootstrap.mockResolvedValue({
      bootstrapStateId: null,
      browserUrl: null,
      installationAccountLogin: 'selected-acme',
      installationId: '12345',
      providerHost: 'github.com',
      registrationId: 'gpr_123',
      repositoryOwner: 'selected-acme',
      status: 'active',
    });
    const setInstallingAccountLogin: Dispatch<SetStateAction<string | null>> = vi.fn();
    const setStatus: Dispatch<SetStateAction<GitHubAccountInstallStatus>> = vi.fn();

    readAccountSelectedHandler(
      'acme-org',
      'fdo_123',
      setInstallingAccountLogin,
      setStatus,
    )({
      appInstallationStatus: 'installed',
      avatarUrl: null,
      login: 'selected-acme',
      type: 'organization',
    });
    await vi.waitFor((): void => {
      expect(assign).toHaveBeenCalledOnce();
    });

    expect(gitApiMocks.startBrowserGitHubProviderBootstrap).toHaveBeenCalledWith(
      'acme-org',
      expect.objectContaining({ repositoryOwner: 'selected-acme' }),
    );
    expect(setStatus).toHaveBeenCalledWith('loading');
    expect(setInstallingAccountLogin).toHaveBeenCalledWith('selected-acme');
    expect(assign.mock.calls[0]?.[0]).toContain('registration=gpr_123');
    expect(assign.mock.calls[0]?.[0]).toContain('owner=selected-acme');
  });
});
