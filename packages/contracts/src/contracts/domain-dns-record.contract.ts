import { z } from 'zod';
import type { ContractSchema } from './schema.types';

const domainDnsRecordPurposeValues: readonly ['ownership', 'routing'] = ['ownership', 'routing'];
const domainDnsRecordTypeValues: readonly ['A', 'AAAA', 'APEX_ALIAS', 'CNAME', 'TXT'] = [
  'A',
  'AAAA',
  'APEX_ALIAS',
  'CNAME',
  'TXT',
];

export type DomainDnsRecordPurpose = 'ownership' | 'routing';
export type DomainDnsRecordType = 'A' | 'AAAA' | 'APEX_ALIAS' | 'CNAME' | 'TXT';

export interface DomainDnsRecord {
  groupId: string;
  name: string;
  purpose: DomainDnsRecordPurpose;
  recordType: DomainDnsRecordType;
  required: boolean;
  value: string;
}

const domainDnsRecordPurposeSchema: ContractSchema<DomainDnsRecordPurpose> = z.enum(domainDnsRecordPurposeValues);
const domainDnsRecordTypeSchema: ContractSchema<DomainDnsRecordType> = z.enum(domainDnsRecordTypeValues);

export const domainDnsRecordSchema: ContractSchema<DomainDnsRecord> = z
  .object({
    groupId: z.string().min(1),
    name: z.string().min(1),
    purpose: domainDnsRecordPurposeSchema,
    recordType: domainDnsRecordTypeSchema,
    required: z.boolean(),
    value: z.string().min(1),
  })
  .strict();
