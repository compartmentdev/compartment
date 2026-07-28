import { z } from 'zod';
import { compartmentProjectNameSchema } from './compartment-descriptor.contract';
import {
  domainDnsRecordSchema,
  type DomainDnsRecord,
  type DomainDnsRecordPurpose,
  type DomainDnsRecordType,
} from './domain-dns-record.contract';
import type { ContractSchema } from './schema.types';

const customDomainStateValues: readonly ['pending', 'reconciling', 'active', 'failed', 'deleting'] = [
  'pending',
  'reconciling',
  'active',
  'failed',
  'deleting',
];
const customDomainCheckStatusValues: readonly ['pending', 'valid', 'invalid'] = ['pending', 'valid', 'invalid'];

export type CustomDomainState = 'pending' | 'reconciling' | 'active' | 'failed' | 'deleting';
export type CustomDomainCheckStatus = 'pending' | 'valid' | 'invalid';
export type CustomDomainDnsRecordPurpose = DomainDnsRecordPurpose;
export type CustomDomainDnsRecordType = DomainDnsRecordType;

export type CustomDomainDnsRecord = DomainDnsRecord;

export interface CustomDomainSummary {
  canonicalRouteHost: string;
  createdAt: string;
  environmentName: string;
  failureMessage: string | null;
  host: string;
  lastCheckedAt: string | null;
  ownershipStatus: CustomDomainCheckStatus;
  projectName: string;
  routingStatus: CustomDomainCheckStatus;
  serviceName: string;
  status: CustomDomainState;
  updatedAt: string;
  verifiedAt: string | null;
}

export interface CreateCustomDomainRequest {
  environmentName?: string | undefined;
  host: string;
  projectName: string;
  serviceName: string;
}

export interface CustomDomainResponse {
  domain: CustomDomainSummary;
}

export interface CreateCustomDomainResponse extends CustomDomainResponse {
  dnsRecords: CustomDomainDnsRecord[];
}

export interface VerifyCustomDomainResponse extends CustomDomainResponse {
  dnsRecords: CustomDomainDnsRecord[];
}

export interface ListCustomDomainsQuery {
  environmentName?: string | undefined;
  projectName?: string | undefined;
  serviceName?: string | undefined;
}

export interface ListCustomDomainsResponse {
  domains: CustomDomainSummary[];
}

export interface RemoveCustomDomainResponse {
  host: string;
  removed: true;
}

const customDomainStateSchema: ContractSchema<CustomDomainState> = z.enum(customDomainStateValues);
const customDomainCheckStatusSchema: ContractSchema<CustomDomainCheckStatus> = z.enum(customDomainCheckStatusValues);

const customDomainSummarySchema: ContractSchema<CustomDomainSummary> = z
  .object({
    canonicalRouteHost: z.string().min(1),
    createdAt: z.string().datetime(),
    environmentName: z.string().min(1),
    failureMessage: z.string().min(1).nullable(),
    host: z.string().min(1),
    lastCheckedAt: z.string().datetime().nullable(),
    ownershipStatus: customDomainCheckStatusSchema,
    projectName: compartmentProjectNameSchema,
    routingStatus: customDomainCheckStatusSchema,
    serviceName: z.string().min(1),
    status: customDomainStateSchema,
    updatedAt: z.string().datetime(),
    verifiedAt: z.string().datetime().nullable(),
  })
  .strict();

export const createCustomDomainRequestSchema: ContractSchema<CreateCustomDomainRequest> = z
  .object({
    environmentName: z.string().min(1).optional(),
    host: z.string().min(1),
    projectName: compartmentProjectNameSchema,
    serviceName: z.string().min(1),
  })
  .strict();

export const customDomainResponseSchema: ContractSchema<CustomDomainResponse> = z
  .object({
    domain: customDomainSummarySchema,
  })
  .strict();

export const createCustomDomainResponseSchema: ContractSchema<CreateCustomDomainResponse> = z
  .object({
    dnsRecords: z.array(domainDnsRecordSchema).min(1),
    domain: customDomainSummarySchema,
  })
  .strict();

export const verifyCustomDomainResponseSchema: ContractSchema<VerifyCustomDomainResponse> = z
  .object({
    dnsRecords: z.array(domainDnsRecordSchema).min(1),
    domain: customDomainSummarySchema,
  })
  .strict();

export const listCustomDomainsQuerySchema: ContractSchema<ListCustomDomainsQuery> = z
  .object({
    environmentName: z.string().min(1).optional(),
    projectName: compartmentProjectNameSchema.optional(),
    serviceName: z.string().min(1).optional(),
  })
  .strict();

export const listCustomDomainsResponseSchema: ContractSchema<ListCustomDomainsResponse> = z
  .object({
    domains: z.array(customDomainSummarySchema),
  })
  .strict();

export const removeCustomDomainResponseSchema: ContractSchema<RemoveCustomDomainResponse> = z
  .object({
    host: z.string().min(1),
    removed: z.literal(true),
  })
  .strict();
