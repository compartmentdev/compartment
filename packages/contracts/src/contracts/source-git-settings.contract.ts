import { z } from 'zod';
import type { ContractSchema } from './schema.types';
import { gitSourceDescriptorPathSchema } from './source-git-sync-path.contract';

export interface GitSourceExclusionSummary {
  descriptorPath: string;
}

export interface GitSourceSettings {
  autoAdoptNewApps: boolean;
  exclusions: GitSourceExclusionSummary[];
}

export interface GitSourceSettingsResponse {
  settings: GitSourceSettings;
}

export interface UpdateGitSourceSettingsRequest {
  autoAdoptNewApps: boolean;
}

export interface UpdateGitSourceExclusionRequest {
  descriptorPath: string;
}

export interface GitSourceExclusionMutationResponse {
  descriptorPath: string;
  sourceId: string;
  success: true;
}

export const gitSourceExclusionSummarySchema: ContractSchema<GitSourceExclusionSummary> = z
  .object({
    descriptorPath: gitSourceDescriptorPathSchema,
  })
  .strict();

const gitSourceSettingsSchema: ContractSchema<GitSourceSettings> = z
  .object({
    autoAdoptNewApps: z.boolean(),
    exclusions: z.array(gitSourceExclusionSummarySchema),
  })
  .strict();

export const gitSourceSettingsResponseSchema: ContractSchema<GitSourceSettingsResponse> = z
  .object({
    settings: gitSourceSettingsSchema,
  })
  .strict();

export const updateGitSourceSettingsRequestSchema: ContractSchema<UpdateGitSourceSettingsRequest> = z
  .object({
    autoAdoptNewApps: z.boolean(),
  })
  .strict();

export const updateGitSourceExclusionRequestSchema: ContractSchema<UpdateGitSourceExclusionRequest> = z
  .object({
    descriptorPath: gitSourceDescriptorPathSchema,
  })
  .strict();

export const gitSourceExclusionMutationResponseSchema: ContractSchema<GitSourceExclusionMutationResponse> = z
  .object({
    descriptorPath: gitSourceDescriptorPathSchema,
    sourceId: z.string().min(1),
    success: z.literal(true),
  })
  .strict();
