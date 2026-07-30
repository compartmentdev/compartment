import {
  buildCompartmentGitHubAccountDiscoveryResultPathname,
  compartmentGitHubAccountDiscoverySessionsPathname,
  gitHubAccountDiscoveryStartResponseSchema,
  type GitHubAccountDiscoveryAccountType,
  type GitHubAccountDiscoveryResultRequest,
  type GitHubAccountDiscoveryStartRequest,
  type GitHubAccountDiscoveryStartResponse,
} from '@compartment/contracts';
import type { JsonValue } from '@compartment/utils';
import { z } from 'zod';
import { createGitSourceRegistrationFailedError } from '../../errors/api-business-error';
import { getApiConfig } from '../../runtime/runtime-access';
import { fetchGitHubAccountDiscoveryBrokerHttp } from '../outbound-http.service';

interface GitHubAccountDiscoveryBrokerConfig {
  token: string;
}

export interface GitHubAccountDiscoveryBrokerAccount {
  avatarUrl: string | null;
  login: string;
  type: GitHubAccountDiscoveryAccountType;
}

export interface GitHubAccountDiscoveryBrokerResultResponse {
  accounts: GitHubAccountDiscoveryBrokerAccount[];
  user: GitHubAccountDiscoveryBrokerAccount;
}

const gitHubAccountDiscoveryBrokerAccountTypeSchema: z.ZodType<GitHubAccountDiscoveryAccountType> = z.enum([
  'organization',
  'user',
]);

const gitHubAccountDiscoveryBrokerAccountSchema: z.ZodType<GitHubAccountDiscoveryBrokerAccount> = z
  .object({
    avatarUrl: z.string().url().nullable(),
    login: z.string().min(1),
    type: gitHubAccountDiscoveryBrokerAccountTypeSchema,
  })
  .strict();

const gitHubAccountDiscoveryBrokerResultResponseSchema: z.ZodType<GitHubAccountDiscoveryBrokerResultResponse> = z
  .object({
    accounts: z.array(gitHubAccountDiscoveryBrokerAccountSchema).min(1),
    user: gitHubAccountDiscoveryBrokerAccountSchema,
  })
  .strict();

export async function startGitHubAccountDiscoveryBrokerSession(
  input: GitHubAccountDiscoveryStartRequest,
): Promise<GitHubAccountDiscoveryStartResponse> {
  const brokerConfig: GitHubAccountDiscoveryBrokerConfig = requireGitHubAccountDiscoveryBrokerConfig();
  const response: JsonValue = await fetchBrokerJson(compartmentGitHubAccountDiscoverySessionsPathname, {
    body: JSON.stringify(input),
    headers: {
      ...buildBrokerAuthorizationHeader(brokerConfig.token),
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  return gitHubAccountDiscoveryStartResponseSchema.parse(response);
}

export async function readGitHubAccountDiscoveryBrokerResult(
  input: GitHubAccountDiscoveryResultRequest,
): Promise<GitHubAccountDiscoveryBrokerResultResponse> {
  const brokerConfig: GitHubAccountDiscoveryBrokerConfig = requireGitHubAccountDiscoveryBrokerConfig();
  const response: JsonValue = await fetchBrokerJson(buildBrokerResultPath(input), {
    headers: buildBrokerAuthorizationHeader(brokerConfig.token),
  });

  return gitHubAccountDiscoveryBrokerResultResponseSchema.parse(response);
}

async function fetchBrokerJson(path: string, init?: RequestInit): Promise<JsonValue> {
  const response: Response = await fetchGitHubAccountDiscoveryBrokerHttp(path, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...init?.headers,
    },
  });
  if (!response.ok) {
    throw createGitSourceRegistrationFailedError(
      `GitHub account discovery broker failed with status ${response.status}.`,
    );
  }

  return (await response.json()) as JsonValue;
}

function requireGitHubAccountDiscoveryBrokerConfig(): GitHubAccountDiscoveryBrokerConfig {
  const brokerUrl: string | null = getApiConfig().managedDomainBrokerUrl ?? null;
  if (brokerUrl === null) {
    throw createGitSourceRegistrationFailedError('GitHub account discovery is not configured for this install.');
  }
  const brokerToken: string | null = getApiConfig().managedDomainAcmeDnsToken ?? null;
  if (brokerToken === null) {
    throw createGitSourceRegistrationFailedError('GitHub account discovery broker credentials are incomplete.');
  }

  return {
    token: brokerToken,
  };
}

function buildBrokerResultPath(input: GitHubAccountDiscoveryResultRequest): string {
  const url: URL = new URL(
    buildCompartmentGitHubAccountDiscoveryResultPathname(input.sessionId),
    'https://broker.local',
  );
  url.searchParams.set('result_token', input.resultToken);

  return `${url.pathname}${url.search}`;
}

function buildBrokerAuthorizationHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}
