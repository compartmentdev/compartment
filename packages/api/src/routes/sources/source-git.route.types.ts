import { z } from 'zod';

export interface GitSourceRouteParams {
  sourceId: string;
}

export interface GitHubBootstrapStateRouteParams {
  bootstrapStateId: string;
}

export interface GitHubProviderRegistrationRouteParams {
  registrationId: string;
}

export interface GitSourceSyncTaskRouteParams {
  sourceId: string;
  taskId: string;
}

export interface GitHubCallbackQuery {
  code: string;
  state: string;
}

export interface GitHubSourceWebhookRouteParams {
  organizationId: string;
  registrationId: string;
}

export interface GitLabSourceWebhookRouteParams {
  organizationId: string;
  registrationId: string;
}

export interface GitHubSetupQuery {
  installation_id: string;
  state: string;
}

export const gitSourceRouteParamsSchema: z.ZodType<GitSourceRouteParams> = z
  .object({
    sourceId: z.string().min(1),
  })
  .strict();

export const gitHubBootstrapStateRouteParamsSchema: z.ZodType<GitHubBootstrapStateRouteParams> = z
  .object({
    bootstrapStateId: z.string().min(1),
  })
  .strict();

export const gitHubProviderRegistrationRouteParamsSchema: z.ZodType<GitHubProviderRegistrationRouteParams> = z
  .object({
    registrationId: z.string().min(1),
  })
  .strict();

export const gitSourceSyncTaskRouteParamsSchema: z.ZodType<GitSourceSyncTaskRouteParams> = z
  .object({
    sourceId: z.string().min(1),
    taskId: z.string().min(1),
  })
  .strict();

export const gitHubCallbackQuerySchema: z.ZodType<GitHubCallbackQuery> = z
  .object({
    code: z.string().min(1),
    state: z.string().min(1),
  })
  .passthrough();

export const gitHubSourceWebhookRouteParamsSchema: z.ZodType<GitHubSourceWebhookRouteParams> = z
  .object({
    organizationId: z.string().min(1),
    registrationId: z.string().min(1),
  })
  .strict();

export const gitLabSourceWebhookRouteParamsSchema: z.ZodType<GitLabSourceWebhookRouteParams> = z
  .object({
    organizationId: z.string().min(1),
    registrationId: z.string().min(1),
  })
  .strict();

export const gitHubSetupQuerySchema: z.ZodType<GitHubSetupQuery> = z
  .object({
    installation_id: z.string().min(1),
    state: z.string().min(1),
  })
  .passthrough();
