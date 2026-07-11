import { githubProviderAdapter } from './github-provider.adapter';
import { gitlabProviderAdapter } from './gitlab-provider.adapter';
import type { GitProviderAdapter, GitProviderType } from './git-source-provider.types';

const gitProviderAdapters: Readonly<Record<GitProviderType, GitProviderAdapter>> = {
  github_app: githubProviderAdapter,
  gitlab: gitlabProviderAdapter,
};

/**
 * Resolve the adapter for a persisted `git_provider_registrations.provider_type`.
 * Throws on an unknown provider so a corrupt or unsupported row fails loudly
 * rather than silently skipping provider-specific behavior.
 */
export function getGitProviderAdapter(providerType: string): GitProviderAdapter {
  return gitProviderAdapters[requireGitProviderType(providerType)];
}

function requireGitProviderType(value: string): GitProviderType {
  if (isGitProviderType(value)) {
    return value;
  }

  throw new Error(`Unsupported git provider type ${value}.`);
}

function isGitProviderType(value: string): value is GitProviderType {
  return value in gitProviderAdapters;
}
