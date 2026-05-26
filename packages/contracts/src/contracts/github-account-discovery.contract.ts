import { z } from 'zod';
import type { ContractSchema } from './schema.types';

export type GitHubAccountDiscoveryAccountType = 'organization' | 'user';
export type GitHubAccountDiscoveryAppInstallationStatus = 'installed' | 'not_installed';

export interface GitHubAccountDiscoveryStartRequest {
  returnTo: string;
}

export interface GitHubAccountDiscoveryStartResponse {
  browserUrl: string;
  sessionId: string;
}

export interface GitHubAccountDiscoveryResultRequest {
  resultToken: string;
  sessionId: string;
}

export interface GitHubAccountDiscoveryAccount {
  appInstallationStatus: GitHubAccountDiscoveryAppInstallationStatus;
  avatarUrl: string | null;
  login: string;
  type: GitHubAccountDiscoveryAccountType;
}

export interface GitHubAccountDiscoveryResultResponse {
  accounts: GitHubAccountDiscoveryAccount[];
  user: GitHubAccountDiscoveryAccount;
}

export const compartmentGitHubAccountDiscoverySessionsPathname: string = '/v1/github/account-discovery/sessions';

export const gitHubAccountDiscoverySessionSearchParamName: string = 'github_account_session';
export const gitHubAccountDiscoveryTokenSearchParamName: string = 'github_account_token';

export const gitHubAccountDiscoveryStartRequestSchema: ContractSchema<GitHubAccountDiscoveryStartRequest> = z
  .object({
    returnTo: z.string().url(),
  })
  .strict();

export const gitHubAccountDiscoveryStartResponseSchema: ContractSchema<GitHubAccountDiscoveryStartResponse> = z
  .object({
    browserUrl: z.string().url(),
    sessionId: z.string().min(1),
  })
  .strict();

export const gitHubAccountDiscoveryResultRequestSchema: ContractSchema<GitHubAccountDiscoveryResultRequest> = z
  .object({
    resultToken: z.string().min(1),
    sessionId: z.string().min(1),
  })
  .strict();

const gitHubAccountDiscoveryAccountTypeSchema: ContractSchema<GitHubAccountDiscoveryAccountType> = z.enum([
  'organization',
  'user',
]);
const gitHubAccountDiscoveryAppInstallationStatusSchema: ContractSchema<GitHubAccountDiscoveryAppInstallationStatus> =
  z.enum(['installed', 'not_installed']);

const gitHubAccountDiscoveryAccountSchema: ContractSchema<GitHubAccountDiscoveryAccount> = z
  .object({
    appInstallationStatus: gitHubAccountDiscoveryAppInstallationStatusSchema,
    avatarUrl: z.string().url().nullable(),
    login: z.string().min(1),
    type: gitHubAccountDiscoveryAccountTypeSchema,
  })
  .strict();

export const gitHubAccountDiscoveryResultResponseSchema: ContractSchema<GitHubAccountDiscoveryResultResponse> = z
  .object({
    accounts: z.array(gitHubAccountDiscoveryAccountSchema).min(1),
    user: gitHubAccountDiscoveryAccountSchema,
  })
  .strict();

export function buildCompartmentGitHubAccountDiscoveryResultPathname(sessionId: string): string {
  return `${compartmentGitHubAccountDiscoverySessionsPathname}/${encodeURIComponent(sessionId)}/result`;
}
