import {
  organizationListResponseSchema,
  type CliRemoteListResponse,
  type CliRemoteRemoveResponse,
  type CliRemoteResponse,
  type CliRemoteSummary,
  type OrganizationSummary,
} from '@compartment/contracts';
import { z } from 'zod';

export const organizationSummarySchema: z.ZodType<OrganizationSummary> = z.custom<OrganizationSummary>(
  (value: OrganizationSummary): boolean => organizationListResponseSchema.safeParse({ organizations: [value] }).success,
  'Invalid organization summary.',
);

const cliRemoteSummarySchema: z.ZodType<CliRemoteSummary> = z
  .object({
    apiUrl: z.string().url(),
    currentOrganization: organizationSummarySchema.nullable(),
    name: z.string().min(1),
  })
  .strict();

export const cliRemoteListResponseSchema: z.ZodType<CliRemoteListResponse> = z
  .object({
    currentRemote: z.string().min(1).nullable(),
    remotes: z.array(cliRemoteSummarySchema),
  })
  .strict();

export const cliRemoteResponseSchema: z.ZodType<CliRemoteResponse> = z
  .object({
    remote: cliRemoteSummarySchema,
  })
  .strict();

export const cliRemoteRemoveResponseSchema: z.ZodType<CliRemoteRemoveResponse> = z
  .object({
    remoteName: z.string().min(1),
  })
  .strict();
