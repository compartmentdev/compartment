import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';
import { buildGitHubApiBaseUrl, hasText } from '@compartment/utils';
import { z } from 'zod';
import { createGitHubTrustedOutboundFetch } from '../outbound-http.service';

interface GitHubAppOctokitInput {
  appId: string;
  privateKeyPem: string;
  providerHost: string;
}

interface GitHubInstallationOctokitInput extends GitHubAppOctokitInput {
  installationId: string;
}

export interface GitHubApiResponse<TData> {
  data: TData;
}

interface GitHubInstallationTokenAuthentication {
  token: string;
}

interface GitHubRequestFailureResponseMessage {
  message?: string | undefined;
}

interface GitHubRequestFailureResponse {
  data?: GitHubRequestFailureResponseMessage | undefined;
}

interface GitHubRequestFailureShape extends Error {
  response?: GitHubRequestFailureResponse | undefined;
  status?: number;
}

interface GitHubOctokitRequestOptions {
  fetch: typeof fetch;
}

type GitHubInstallationTokenInput = GitHubInstallationOctokitInput;

const gitHubEmptyRepositoryFailureMessage: string = 'Git Repository is empty';

export function createGitHubAppOctokit(input: GitHubAppOctokitInput): Octokit {
  return new Octokit({
    auth: {
      appId: input.appId,
      privateKey: input.privateKeyPem,
    },
    authStrategy: createAppAuth,
    baseUrl: buildGitHubApiBaseUrl(input.providerHost),
    request: createGitHubOctokitRequestOptions(),
    userAgent: 'compartment',
  });
}

export function createGitHubUnauthenticatedOctokit(providerHost: string): Octokit {
  return new Octokit({
    baseUrl: buildGitHubApiBaseUrl(providerHost),
    request: createGitHubOctokitRequestOptions(),
    userAgent: 'compartment',
  });
}

export async function mintGitHubInstallationToken(input: GitHubInstallationTokenInput): Promise<string> {
  const authentication: GitHubInstallationTokenAuthentication = gitHubInstallationTokenAuthenticationSchema.parse(
    await createGitHubInstallationOctokit(input).auth({
      type: 'installation',
    }),
  );

  return authentication.token;
}

export function createGitHubInstallationOctokit(input: GitHubInstallationOctokitInput): Octokit {
  return new Octokit({
    auth: {
      appId: input.appId,
      installationId: input.installationId,
      privateKey: input.privateKeyPem,
    },
    authStrategy: createAppAuth,
    baseUrl: buildGitHubApiBaseUrl(input.providerHost),
    request: createGitHubOctokitRequestOptions(),
    userAgent: 'compartment',
  });
}

function createGitHubOctokitRequestOptions(): GitHubOctokitRequestOptions {
  return {
    fetch: createGitHubTrustedOutboundFetch(),
  };
}

export function isGitHubRepositoryAccessFailure(error: Error | null | undefined): boolean {
  const status: number | null = readGitHubRequestFailureStatus(error);
  return status === 403 || status === 404;
}

export function isGitHubRepositoryEmptyFailure(error: Error | null | undefined): boolean {
  return (
    readGitHubRequestFailureStatus(error) === 409 &&
    readGitHubRequestFailureMessage(error) === gitHubEmptyRepositoryFailureMessage
  );
}

export function isGitHubAppAuthenticationFailure(error: Error | null | undefined): boolean {
  const status: number | null = readGitHubRequestFailureStatus(error);
  return status === 401 || status === 404;
}

export function isGitHubRequestFailure(error: Error | null | undefined): boolean {
  return readGitHubRequestFailureStatus(error) !== null;
}

export function isGitHubTransportFailure(error: Error | null | undefined): boolean {
  return isOctokitTransportFailure(error);
}

export function requireGitHubField(value: number | string | null | undefined, label: string): string {
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new Error(`GitHub response did not include ${label}.`);
  }

  return String(value);
}

export function readOptionalGitHubField(value: string | null | undefined): string | null {
  return hasText(value) ? value : null;
}

function readGitHubRequestFailureStatus(error: Error | null | undefined): number | null {
  if (error !== null && error !== undefined && 'status' in error && typeof error.status === 'number') {
    return error.status;
  }

  return null;
}

function readGitHubRequestFailureMessage(error: Error | null | undefined): string | null {
  if (error === null || error === undefined || !('response' in error)) {
    return null;
  }

  const message: string | undefined = (error as GitHubRequestFailureShape).response?.data?.message;
  return hasText(message) ? message : null;
}

function isOctokitTransportFailure(error: Error | null | undefined): boolean {
  if (error === null || error === undefined || !hasNamedGitHubFailure(error, 'HttpError')) {
    return false;
  }

  const requestFailure: GitHubRequestFailureShape = error;
  return typeof requestFailure.status === 'number' && requestFailure.response === undefined;
}

function hasNamedGitHubFailure(error: Error | null | undefined, errorName: string): boolean {
  return error?.name === errorName;
}

const gitHubInstallationTokenAuthenticationSchema: z.ZodType<GitHubInstallationTokenAuthentication> = z
  .object({
    token: z.string().min(1),
  })
  .passthrough();
