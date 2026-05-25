import type { Octokit } from '@octokit/rest';
import { slugifyText } from '@compartment/utils';
import type { GitHubAppManifestPlan } from './github-app-client.adapter.types';
import {
  type GitHubApiResponse,
  createGitHubUnauthenticatedOctokit,
  requireGitHubField,
} from './github-app-http.adapter';

interface GitHubManifestPayload {
  default_events: string[];
  default_permissions: Record<string, string>;
  description: string;
  hook_attributes: {
    url: string;
  };
  name: string;
  public: boolean;
  redirect_url: string;
  setup_on_update: boolean;
  setup_url: string;
  url: string;
}

type GitHubOwnerType = 'Organization' | 'User';

interface GitHubOwnerApiResponse {
  type?: string | undefined;
}

interface BuildGitHubManifestPayloadInput {
  callbackUrl: string;
  controlPlaneUrl: string;
  repositoryOwner: string;
  setupUrl: string;
  webhookUrl: string;
}

const gitHubAppNameMaxLength: number = 34;
const gitHubAppNamePrefix: string = 'Compartment';

export async function readGitHubAppManifestPlan(input: {
  callbackUrl: string;
  controlPlaneUrl: string;
  providerHost: string;
  repositoryOwner: string;
  setupUrl: string;
  webhookUrl: string;
}): Promise<GitHubAppManifestPlan> {
  return {
    formActionUrl: buildGitHubAppRegistrationUrl(
      input.providerHost,
      input.repositoryOwner,
      await readGitHubOwnerType(input.providerHost, input.repositoryOwner),
    ),
    manifestJson: JSON.stringify(
      buildGitHubManifestPayload({
        callbackUrl: input.callbackUrl,
        controlPlaneUrl: input.controlPlaneUrl,
        repositoryOwner: input.repositoryOwner,
        setupUrl: input.setupUrl,
        webhookUrl: input.webhookUrl,
      }),
    ),
  };
}

export function buildGitHubAppInstallUrl(providerHost: string, appSlug: string, state: string): string {
  return `${buildGitHubWebBaseUrl(providerHost)}/apps/${encodeURIComponent(appSlug)}/installations/new?state=${encodeURIComponent(state)}`;
}

async function readGitHubOwnerType(providerHost: string, repositoryOwner: string): Promise<GitHubOwnerType> {
  const octokit: Octokit = createGitHubUnauthenticatedOctokit(providerHost);
  const response: GitHubApiResponse<GitHubOwnerApiResponse> = await octokit.rest.users.getByUsername({
    username: repositoryOwner,
  });
  return readGitHubOwnerTypeValue(requireGitHubField(response.data.type, 'type'));
}

function buildGitHubManifestPayload(input: BuildGitHubManifestPayloadInput): GitHubManifestPayload {
  return {
    // GitHub Apps receive installation lifecycle events by default and reject
    // them when they are listed explicitly in the manifest payload.
    default_events: ['push'],
    default_permissions: {
      contents: 'write',
      metadata: 'read',
      pull_requests: 'write',
    },
    description: 'Compartment Git source integration',
    hook_attributes: {
      url: input.webhookUrl,
    },
    name: buildGitHubAppName(input.repositoryOwner),
    public: false,
    redirect_url: input.callbackUrl,
    setup_on_update: false,
    setup_url: input.setupUrl,
    url: input.controlPlaneUrl,
  };
}

function buildGitHubAppName(repositoryOwner: string): string {
  const ownerSegment: string = truncateGitHubAppNameSegment(
    readGitHubAppNameSegment(repositoryOwner),
    readGitHubAppOwnerSegmentLength(),
  );

  return `${gitHubAppNamePrefix} ${ownerSegment}`;
}

function readGitHubAppOwnerSegmentLength(): number {
  return gitHubAppNameMaxLength - gitHubAppNamePrefix.length - 1;
}

function readGitHubAppNameSegment(value: string): string {
  const segment: string = slugifyText(value);
  return segment === '' ? 'runtime' : segment;
}

function truncateGitHubAppNameSegment(value: string, maxLength: number): string {
  const segment: string = value.slice(0, Math.max(1, maxLength)).replace(/-$/g, '');
  return segment === '' ? 'runtime' : segment;
}

function buildGitHubAppRegistrationUrl(
  providerHost: string,
  repositoryOwner: string,
  ownerType: GitHubOwnerType,
): string {
  const baseUrl: string = buildGitHubWebBaseUrl(providerHost);
  if (ownerType === 'Organization') {
    return `${baseUrl}/organizations/${encodeURIComponent(repositoryOwner)}/settings/apps/new`;
  }
  return `${baseUrl}/settings/apps/new`;
}

function readGitHubOwnerTypeValue(value: string): GitHubOwnerType {
  if (value === 'Organization' || value === 'User') {
    return value;
  }
  throw new Error(`Unsupported GitHub owner type "${value}".`);
}

function buildGitHubWebBaseUrl(providerHost: string): string {
  return `https://${providerHost}`;
}
