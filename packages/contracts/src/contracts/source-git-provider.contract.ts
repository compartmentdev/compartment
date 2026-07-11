import { z } from 'zod';
import type { ContractSchema } from './schema.types';

export type GitProviderType = 'github_app' | 'gitlab';
export type GitHubProviderRegistrationStatus = 'active' | 'failed' | 'pending';
export type GitDescriptorPlanStatus = 'descriptor_found' | 'descriptor_missing';
export type GitDescriptorPullRequestState = 'closed' | 'merged' | 'open';

export const gitProviderTypeSchema: ContractSchema<GitProviderType> = z.enum(['github_app', 'gitlab']);
export const gitHubProviderRegistrationStatusSchema: ContractSchema<GitHubProviderRegistrationStatus> = z.enum([
  'active',
  'failed',
  'pending',
]);
export const gitDescriptorPlanStatusSchema: ContractSchema<GitDescriptorPlanStatus> = z.enum([
  'descriptor_found',
  'descriptor_missing',
]);
export const gitDescriptorPullRequestStateSchema: ContractSchema<GitDescriptorPullRequestState> = z.enum([
  'closed',
  'merged',
  'open',
]);

export const gitProviderHostSchema: z.ZodType<string> = z
  .string()
  .trim()
  .min(1)
  .transform(normalizeGitProviderHost)
  .refine(isValidGitProviderHost, 'Expected a valid git provider hostname.');

function normalizeGitProviderHost(value: string): string {
  return value.trim().toLowerCase();
}

function isValidGitProviderHost(value: string): boolean {
  try {
    const parsed: URL = new URL(`https://${value}`);
    return parsed.host === value && parsed.hostname !== '';
  } catch {
    return false;
  }
}
