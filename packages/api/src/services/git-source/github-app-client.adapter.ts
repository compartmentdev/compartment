import type { Octokit } from '@octokit/rest';
import type {
  GitHubAppInstallation,
  GitHubManifestConversionResult,
  GitHubRepositoryInstallation,
  GitHubRepositoryMetadata,
} from './github-app-client.adapter.types';
import {
  type GitHubApiResponse,
  createGitHubAppOctokit,
  createGitHubInstallationOctokit,
  createGitHubUnauthenticatedOctokit,
  readOptionalGitHubField,
  requireGitHubField,
} from './github-app-http.adapter';

export {
  assertGitHubRepositoryBranchExists,
  createGitHubRepositoryDescriptorPullRequest,
  listGitHubInstallationRepositories,
  readGitHubRepositoryContent,
  readGitHubRepositoryPullRequestStatus,
  readGitHubRepositoryTree,
} from './github-app-repository.adapter';

interface GitHubManifestConversionApiResponse {
  html_url?: string;
  id?: number;
  name?: string;
  pem?: string;
  slug?: string;
  webhook_secret?: string | null;
}

interface GitHubInstallationAccountApiResponse {
  login?: string | undefined;
  slug?: string | undefined;
  type?: string | undefined;
}

interface GitHubRepositoryApiResponse {
  clone_url?: string;
  default_branch?: string;
  id?: number;
  name?: string;
  owner?: {
    login?: string;
  };
  private?: boolean;
}

export async function exchangeGitHubAppManifestCode(input: {
  manifestCode: string;
  providerHost: string;
}): Promise<GitHubManifestConversionResult> {
  const octokit: Octokit = createGitHubUnauthenticatedOctokit(input.providerHost);
  const response: GitHubApiResponse<GitHubManifestConversionApiResponse> = await octokit.rest.apps.createFromManifest({
    code: input.manifestCode,
  });

  return toGitHubManifestConversionResult(response.data);
}

export async function assertGitHubAppStillExists(input: {
  appId: string;
  privateKeyPem: string;
  providerHost: string;
}): Promise<void> {
  await createGitHubAppOctokit(input).rest.apps.getAuthenticated();
}

export async function resolveGitHubRepositoryInstallation(input: {
  appId: string;
  owner: string;
  privateKeyPem: string;
  providerHost: string;
  repositoryName: string;
}): Promise<GitHubRepositoryInstallation> {
  const octokit: Octokit = createGitHubAppOctokit(input);
  const response: GitHubApiResponse<{ id?: number | undefined }> = await octokit.rest.apps.getRepoInstallation({
    owner: input.owner,
    repo: input.repositoryName,
  });

  return {
    installationId: String(requireGitHubField(response.data.id, 'id')),
  };
}

export async function readGitHubAppInstallation(input: {
  appId: string;
  installationId: string;
  privateKeyPem: string;
  providerHost: string;
}): Promise<GitHubAppInstallation> {
  const octokit: Octokit = createGitHubAppOctokit(input);
  const response: GitHubApiResponse<{
    account?: GitHubInstallationAccountApiResponse | null | undefined;
    id?: number | undefined;
  }> = await octokit.rest.apps.getInstallation({
    installation_id: Number(input.installationId),
  });
  const account: GitHubInstallationAccountApiResponse | null | undefined = response.data.account;

  return {
    accountLogin: requireGitHubField(account?.login ?? account?.slug, 'account.login'),
    accountType: requireGitHubField(
      account?.type ?? readGitHubInstallationAccountType(account ?? null),
      'account.type',
    ),
    installationId: String(requireGitHubField(response.data.id, 'id')),
  };
}

export async function readGitHubRepositoryMetadata(input: {
  appId: string;
  installationId: string;
  owner: string;
  privateKeyPem: string;
  providerHost: string;
  repositoryName: string;
}): Promise<GitHubRepositoryMetadata> {
  const octokit: Octokit = createGitHubInstallationOctokit(input);
  const response: GitHubApiResponse<GitHubRepositoryApiResponse> = await octokit.rest.repos.get({
    owner: input.owner,
    repo: input.repositoryName,
  });

  return toGitHubRepositoryMetadata(response.data);
}

function toGitHubManifestConversionResult(
  response: GitHubManifestConversionApiResponse,
): GitHubManifestConversionResult {
  return {
    appId: String(requireGitHubField(response.id, 'id')),
    appName: readOptionalGitHubField(response.name),
    appSlug: requireGitHubField(response.slug, 'slug'),
    appUrl: readOptionalGitHubField(response.html_url),
    privateKeyPem: requireGitHubField(response.pem, 'pem'),
    webhookSecret: requireGitHubField(response.webhook_secret, 'webhook_secret'),
  };
}

function readGitHubInstallationAccountType(account: GitHubInstallationAccountApiResponse | null): string | undefined {
  if (account?.slug !== undefined) {
    return 'Organization';
  }

  return undefined;
}

function toGitHubRepositoryMetadata(response: GitHubRepositoryApiResponse): GitHubRepositoryMetadata {
  return {
    defaultBranchName: requireGitHubField(response.default_branch, 'default_branch'),
    repositoryCloneUrl: requireGitHubField(response.clone_url, 'clone_url'),
    repositoryExternalId: String(requireGitHubField(response.id, 'id')),
    repositoryName: requireGitHubField(response.name, 'name'),
    repositoryOwner: requireGitHubField(response.owner?.login, 'owner.login'),
  };
}
