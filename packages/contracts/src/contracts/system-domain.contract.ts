import { z } from 'zod';
import { domainDnsRecordSchema, type DomainDnsRecord } from './domain-dns-record.contract';
import type { ContractSchema } from './schema.types';

const domainKindValues: readonly ['managed', 'custom', 'local'] = ['managed', 'custom', 'local'];
const domainTlsModeValues: readonly ['broker-dns01', 'custom-cert', 'external', 'internal'] = [
  'broker-dns01',
  'custom-cert',
  'external',
  'internal',
];
const domainPublicSchemeValues: readonly ['http', 'https'] = ['http', 'https'];
const systemDomainPendingStatusValues: readonly ['pending_dns', 'pending_cert', 'verified'] = [
  'pending_dns',
  'pending_cert',
  'verified',
];
const systemDomainHealthStatusValues: readonly ['unknown', 'ok', 'unhealthy'] = ['unknown', 'ok', 'unhealthy'];

export type DomainKind = 'managed' | 'custom' | 'local';
export type DomainTlsMode = 'broker-dns01' | 'custom-cert' | 'external' | 'internal';
export type DomainPublicScheme = 'http' | 'https';
export type SystemDomainPendingStatus = 'pending_dns' | 'pending_cert' | 'verified';
export type SystemDomainHealthStatus = 'unknown' | 'ok' | 'unhealthy';

export interface DomainIssuerReference {
  kind: 'Issuer' | 'ClusterIssuer';
  name: string;
}

const domainIssuerReferenceSchema: ContractSchema<DomainIssuerReference> = z
  .object({
    kind: z.enum(['Issuer', 'ClusterIssuer']),
    name: z.string().min(1),
  })
  .strict();

export interface DomainHostPlan {
  baseDomain: string;
  domainKind: DomainKind;
  issuerRef?: DomainIssuerReference | undefined;
  publicScheme: DomainPublicScheme;
  tlsMode: DomainTlsMode;
}

export interface DomainCertificateMetadata {
  dnsNames: string[];
  expiresAt: string;
  fingerprintSha256: string;
  issuedAt: string;
  issuer: string;
  serialNumber: string;
  subject: string;
}

export interface SystemDomainCertificate {
  metadata: DomainCertificateMetadata;
  secretName: string;
}

export interface SystemDomainHealth {
  checkedAt: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  status: SystemDomainHealthStatus;
}

export interface SystemDomainPendingOperation {
  certificate: SystemDomainCertificate | null;
  failureCode: string | null;
  failureMessage: string | null;
  hostPlan: DomainHostPlan;
  operationId: string;
  requiredDnsRecords: DomainDnsRecord[];
  status: SystemDomainPendingStatus;
}

export interface SystemDomainStatusResponse {
  active: DomainHostPlan;
  activeDomainHealth: SystemDomainHealth;
  setupVersion: number;
  pending: SystemDomainPendingOperation | null;
}

export interface SystemDomainSetRequest {
  expectedSetupVersion: number;
  hostPlan: DomainHostPlan;
}

export interface SystemDomainAttachCertificateRequest {
  certificate: SystemDomainCertificate;
  expectedSetupVersion: number;
}

export interface SystemDomainVersionedRequest {
  expectedSetupVersion: number;
}

export interface SystemDomainMutationResponse {
  setupVersion: number;
  operationId: string;
  status: SystemDomainStatusResponse;
}

const domainKindSchema: ContractSchema<DomainKind> = z.enum(domainKindValues);
const domainTlsModeSchema: ContractSchema<DomainTlsMode> = z.enum(domainTlsModeValues);
const domainPublicSchemeSchema: ContractSchema<DomainPublicScheme> = z.enum(domainPublicSchemeValues);
export const systemDomainPendingStatusSchema: ContractSchema<SystemDomainPendingStatus> = z.enum(
  systemDomainPendingStatusValues,
);
const systemDomainHealthStatusSchema: ContractSchema<SystemDomainHealthStatus> = z.enum(systemDomainHealthStatusValues);

export const domainHostPlanSchema: ContractSchema<DomainHostPlan> = z
  .object({
    baseDomain: z.string().min(1),
    domainKind: domainKindSchema,
    issuerRef: domainIssuerReferenceSchema.optional(),
    publicScheme: domainPublicSchemeSchema,
    tlsMode: domainTlsModeSchema,
  })
  .strict();

const domainCertificateMetadataSchema: ContractSchema<DomainCertificateMetadata> = z
  .object({
    dnsNames: z.array(z.string().min(1)).min(1),
    expiresAt: z.string().datetime(),
    fingerprintSha256: z.string().min(1),
    issuedAt: z.string().datetime(),
    issuer: z.string().min(1),
    serialNumber: z.string().min(1),
    subject: z.string().min(1),
  })
  .strict();

export const systemDomainCertificateSchema: ContractSchema<SystemDomainCertificate> = z
  .object({
    metadata: domainCertificateMetadataSchema,
    secretName: z
      .string()
      .min(1)
      .max(253)
      .regex(/^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/u),
  })
  .strict();

const systemDomainHealthSchema: ContractSchema<SystemDomainHealth> = z
  .object({
    checkedAt: z.string().datetime().nullable(),
    failureCode: z.string().min(1).nullable(),
    failureMessage: z.string().min(1).nullable(),
    status: systemDomainHealthStatusSchema,
  })
  .strict();

const systemDomainPendingOperationSchema: ContractSchema<SystemDomainPendingOperation> = z
  .object({
    certificate: systemDomainCertificateSchema.nullable(),
    failureCode: z.string().min(1).nullable(),
    failureMessage: z.string().min(1).nullable(),
    hostPlan: domainHostPlanSchema,
    operationId: z.string().min(1),
    requiredDnsRecords: z.array(domainDnsRecordSchema),
    status: systemDomainPendingStatusSchema,
  })
  .strict();

export const systemDomainStatusResponseSchema: ContractSchema<SystemDomainStatusResponse> = z
  .object({
    active: domainHostPlanSchema,
    activeDomainHealth: systemDomainHealthSchema,
    setupVersion: z.number().int().nonnegative(),
    pending: systemDomainPendingOperationSchema.nullable(),
  })
  .strict();

export const systemDomainSetRequestSchema: ContractSchema<SystemDomainSetRequest> = z
  .object({
    expectedSetupVersion: z.number().int().nonnegative(),
    hostPlan: domainHostPlanSchema,
  })
  .strict();

export const systemDomainAttachCertificateRequestSchema: ContractSchema<SystemDomainAttachCertificateRequest> = z
  .object({
    certificate: systemDomainCertificateSchema,
    expectedSetupVersion: z.number().int().nonnegative(),
  })
  .strict();

export const systemDomainVersionedRequestSchema: ContractSchema<SystemDomainVersionedRequest> = z
  .object({
    expectedSetupVersion: z.number().int().nonnegative(),
  })
  .strict();

export const systemDomainMutationResponseSchema: ContractSchema<SystemDomainMutationResponse> = z
  .object({
    setupVersion: z.number().int().nonnegative(),
    operationId: z.string().min(1),
    status: systemDomainStatusResponseSchema,
  })
  .strict();
