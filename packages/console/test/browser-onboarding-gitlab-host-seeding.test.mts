// @vitest-environment jsdom

import type {
  GitProviderRegistrationListResponse,
  GitProviderRegistrationSummary,
} from '@compartment/contracts/browser';
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { listBrowserGitProviderRegistrations } from '../src/features/onboarding/onboarding-git-api';
import { GitLabConnect } from '../src/features/onboarding/onboarding-gitlab-connect';

type ListBrowserGitProviderRegistrations = typeof listBrowserGitProviderRegistrations;

const mocks: { listRegistrations: Mock<ListBrowserGitProviderRegistrations> } = vi.hoisted(
  (): { listRegistrations: Mock<ListBrowserGitProviderRegistrations> } => ({
    listRegistrations: vi.fn<ListBrowserGitProviderRegistrations>(),
  }),
);

vi.mock('../src/features/onboarding/onboarding-git-api', (): object => ({
  createBrowserGitLabProviderRegistration: vi.fn(),
  listBrowserGitProviderRegistrations: mocks.listRegistrations,
}));

const reactGlobal: typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean } = globalThis;
reactGlobal.IS_REACT_ACT_ENVIRONMENT = true;

afterEach((): void => {
  vi.resetAllMocks();
  document.body.innerHTML = '';
});

describe('GitLab host seeding', (): void => {
  it('does not overwrite a host typed before registrations load', async (): Promise<void> => {
    let resolveRegistrations: (value: GitProviderRegistrationListResponse) => void;
    mocks.listRegistrations.mockReturnValue(
      new Promise<GitProviderRegistrationListResponse>(
        (resolve: (value: GitProviderRegistrationListResponse) => void): void => {
          resolveRegistrations = resolve;
        },
      ),
    );
    const container: HTMLDivElement = document.createElement('div');
    const root: Root = createRoot(container);
    document.body.append(container);
    act((): void => {
      root.render(createGitLabConnectElement());
    });
    const input: HTMLInputElement = container.querySelector('input')!;
    await act(async (): Promise<void> => {
      setInputValue(input, 'typed.example.com');
      resolveRegistrations({ registrations: [createRegistration()] });
      await Promise.resolve();
    });
    expect(input.value).toBe('typed.example.com');
    act((): void => {
      root.unmount();
    });
  });
});

function createGitLabConnectElement(): ReactElement {
  return createElement(GitLabConnect, {
    navigate: (): void => undefined,
    selectedOrganizationSlug: 'acme-dev',
  });
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter: ((value: string) => void) | undefined = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set?.bind(input);
  setter?.(value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function createRegistration(): GitProviderRegistrationSummary {
  return {
    createdAt: '2026-07-11T00:00:00.000Z',
    expiresAt: null,
    providerAccountLogin: 'alice',
    providerHost: 'registered.example.com',
    providerType: 'gitlab',
    registrationId: 'gpr_1',
  };
}
