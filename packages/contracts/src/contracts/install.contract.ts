import { z } from 'zod';
import { operationSummarySchema, type OperationSummary } from './operations.contract';
import { organizationSlugSchema, organizationSummarySchema, type OrganizationSummary } from './organizations.contract';
import type { ContractSchema } from './schema.types';

export type DnsRecordType = 'A/AAAA-or-CNAME';

export interface DnsRecordInstruction {
  host: string;
  purpose: string;
  type: DnsRecordType;
}

export interface InstallRequest {
  adminEmail: string;
  adminPassword: string;
  baseDomain: string;
  organizationName: string;
  organizationSlug?: string | undefined;
}

export interface InstallResponse {
  adminEmail: string;
  baseDomain: string;
  dnsRecords: DnsRecordInstruction[];
  operation: OperationSummary;
  organization: OrganizationSummary;
  compartmentUrl: string;
  sessionToken: string;
}

const dnsRecordTypeSchema: ContractSchema<DnsRecordType> = z.enum(['A/AAAA-or-CNAME']);

export const dnsRecordInstructionSchema: ContractSchema<DnsRecordInstruction> = z
  .object({
    host: z.string().min(1),
    purpose: z.string().min(1),
    type: dnsRecordTypeSchema,
  })
  .strict();

export const installRequestSchema: ContractSchema<InstallRequest> = z
  .object({
    adminEmail: z.string().email(),
    adminPassword: z.string().min(8),
    baseDomain: z.string().min(1),
    organizationName: z.string().min(1),
    organizationSlug: organizationSlugSchema.optional(),
  })
  .strict();

export const installResponseSchema: ContractSchema<InstallResponse> = z
  .object({
    adminEmail: z.string().email(),
    baseDomain: z.string().min(1),
    dnsRecords: z.array(dnsRecordInstructionSchema).min(1),
    operation: operationSummarySchema,
    organization: organizationSummarySchema,
    compartmentUrl: z.string().url(),
    sessionToken: z.string().min(1),
  })
  .strict();
