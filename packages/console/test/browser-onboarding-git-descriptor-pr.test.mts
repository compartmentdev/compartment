import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { GitDescriptorPullRequestResponse } from '@compartment/contracts/browser';
import type { createBrowserGitDescriptorPullRequest } from '../src/features/onboarding/onboarding-git-api';
import { handleCreatePullRequest } from '../src/features/onboarding/onboarding-git-actions';
import { GitDescriptorPrStep } from '../src/features/onboarding/onboarding-git-descriptor-pr';
import type { GitConnectFormInput, GitDescriptorTargetOption } from '../src/features/onboarding/onboarding-page.types';

type CreateBrowserGitDescriptorPullRequest = typeof createBrowserGitDescriptorPullRequest;

interface OnboardingGitApiModule {
  createBrowserGitDescriptorPullRequest: Mock<CreateBrowserGitDescriptorPullRequest>;
  readBrowserGitDescriptorPullRequestStatus: Mock;
}

const mocks: {
  createBrowserGitDescriptorPullRequest: Mock<CreateBrowserGitDescriptorPullRequest>;
} = vi.hoisted(
  (): {
    createBrowserGitDescriptorPullRequest: Mock<CreateBrowserGitDescriptorPullRequest>;
  } => ({
    createBrowserGitDescriptorPullRequest: vi.fn<CreateBrowserGitDescriptorPullRequest>(),
  }),
);

vi.mock(
  '../src/features/onboarding/onboarding-git-api',
  (): OnboardingGitApiModule => ({
    createBrowserGitDescriptorPullRequest: mocks.createBrowserGitDescriptorPullRequest,
    readBrowserGitDescriptorPullRequestStatus: vi.fn(),
  }),
);

describe('browser onboarding Git descriptor preview', (): void => {
  afterEach((): void => {
    vi.resetAllMocks();
  });

  it('renders every starter draft file in the PR preview', (): void => {
    const target: GitDescriptorTargetOption = createStarterTarget();
    const markup: string = renderToStaticMarkup(
      createElement(GitDescriptorPrStep, {
        formInput: createFormInput(),
        isPrPending: false,
        onCreatePr: async (): Promise<GitDescriptorPullRequestResponse> =>
          await Promise.resolve(createPullRequestResponse()),
        onPrCreated: (): void => undefined,
        onPrMerged: async (): Promise<void> => await Promise.resolve(),
        onTargetChange: (): void => undefined,
        target,
        targetOptions: [target],
      }),
    );

    expect(markup).toContain('Create starter app pull request');
    expect(markup).toContain('PR files');
    expect(markup).toContain('compartment.yml');
    expect(markup).toContain('apps/site/index.html');
    expect(markup).toContain('Hello, this is your first Compartment app.');
  });

  it('sends every draft file when creating the pull request', async (): Promise<void> => {
    mocks.createBrowserGitDescriptorPullRequest.mockResolvedValueOnce(createPullRequestResponse());

    await handleCreatePullRequest('acme-dev', createFormInput(), createStarterTarget());

    expect(mocks.createBrowserGitDescriptorPullRequest).toHaveBeenCalledWith('acme-dev', {
      appFolder: '.',
      branchName: 'main',
      descriptorPath: 'compartment.yml',
      files: [
        {
          content:
            'name: mono\n\nservices:\n  web:\n    accessMode: public\n    kind: static\n    path: .\n    build:\n      outputDirectory: apps/site\n',
          path: 'compartment.yml',
        },
        {
          content:
            '<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1" />\n    <title>Compartment Starter App</title>\n  </head>\n  <body>\n    <p>Hello, this is your first Compartment app.</p>\n  </body>\n</html>\n',
          path: 'apps/site/index.html',
        },
      ],
      projectName: 'mono',
      providerHost: 'github.com',
      registrationId: 'gpr_123',
      repositoryName: 'mono',
      repositoryOwner: 'acme',
    });
  });

  it('uses merge request wording for GitLab repositories', (): void => {
    const target: GitDescriptorTargetOption = createStarterTarget();
    const formInput: GitConnectFormInput = createFormInput();
    formInput.repository = { ...formInput.repository, provider: 'gitlab', providerHost: 'gitlab.com' };
    const markup: string = renderToStaticMarkup(
      createElement(GitDescriptorPrStep, {
        formInput,
        isPrPending: false,
        onCreatePr: async (): Promise<GitDescriptorPullRequestResponse> =>
          await Promise.resolve(createPullRequestResponse()),
        onPrCreated: (): void => undefined,
        onPrMerged: async (): Promise<void> => await Promise.resolve(),
        onTargetChange: (): void => undefined,
        target,
        targetOptions: [target],
      }),
    );

    expect(markup).toContain('Create starter app merge request');
    expect(markup).toContain('MR files');
  });
});

function createFormInput(): GitConnectFormInput {
  return {
    branchName: 'main',
    environmentName: 'production',
    repository: {
      defaultBranchName: 'main',
      id: 'repo_123',
      name: 'mono',
      owner: 'acme',
      provider: 'github',
      providerHost: 'github.com',
      registrationId: 'gpr_123',
    },
  };
}

function createStarterTarget(): GitDescriptorTargetOption {
  return {
    descriptorPath: 'compartment.yml',
    directory: '.',
    files: [
      {
        content:
          'name: mono\n\nservices:\n  web:\n    accessMode: public\n    kind: static\n    path: .\n    build:\n      outputDirectory: apps/site\n',
        path: 'compartment.yml',
      },
      {
        content:
          '<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1" />\n    <title>Compartment Starter App</title>\n  </head>\n  <body>\n    <p>Hello, this is your first Compartment app.</p>\n  </body>\n</html>\n',
        path: 'apps/site/index.html',
      },
    ],
    id: 'compartment_yml',
    packageJsonPath: null,
    projectName: 'mono',
  };
}

function createPullRequestResponse(): GitDescriptorPullRequestResponse {
  return {
    descriptorPath: 'compartment.yml',
    pullRequestNumber: 17,
    pullRequestUrl: 'https://github.com/acme/mono/pull/17',
    state: 'open',
    statusToken: 'descriptor-pr-status-token',
  };
}
