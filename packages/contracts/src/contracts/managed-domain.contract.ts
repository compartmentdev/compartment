import { z } from 'zod';
import { dnsRecordInstructionSchema, type DnsRecordInstruction } from './install.contract';
import type { ContractSchema } from './schema.types';

export const managedDomainRequestedLabelSourceMaxLength: number = 128;
export const managedDomainAllocationPathname: string = '/v1/managed-domains';
export const managedDomainAliasPathname: string = `${managedDomainAllocationPathname}/aliases`;

export interface ManagedDomainAllocationRequest {
  installationId: string;
  metadata?: ManagedDomainAllocationMetadata | undefined;
  publicIp: string;
  requestedLabelSource: string;
}

export interface ManagedDomainAllocationMetadata {
  cliVersion: string;
  os: ManagedDomainAllocationOsMetadata;
  runtimeVersion: string;
}

export interface ManagedDomainAllocationOsMetadata {
  arch: string;
  platform: string;
  release: string;
}

export interface ManagedDomainAllocationResponse {
  acmeDnsToken: string;
  baseDomain: string;
  dnsRecords: DnsRecordInstruction[];
}

export interface ManagedDomainAliasUpsertRequest {
  baseDomain: string;
}

export const managedDomainAllocationResponseSchema: ContractSchema<ManagedDomainAllocationResponse> = z
  .object({
    acmeDnsToken: z.string().min(1),
    baseDomain: z.string().min(1),
    dnsRecords: z.array(dnsRecordInstructionSchema).min(1),
  })
  .strict();
