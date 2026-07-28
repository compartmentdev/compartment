import type {
  DomainDnsRecord,
  DomainHostPlan,
  SystemDomainCertificate,
  SystemDomainHealthStatus,
  SystemDomainPendingStatus,
} from '@compartment/contracts';

export interface SystemDomainHealthResult {
  checkedAt: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  status: SystemDomainHealthStatus;
}

export interface SystemDomainPendingResult {
  certificate: SystemDomainCertificate | null;
  failureCode: string | null;
  failureMessage: string | null;
  hostPlan: DomainHostPlan;
  operationId: string;
  requiredDnsRecords: DomainDnsRecord[];
  status: SystemDomainPendingStatus;
}

export interface SystemDomainStatusResult {
  active: DomainHostPlan;
  activeDomainHealth: SystemDomainHealthResult;
  setupVersion: number;
  pending: SystemDomainPendingResult | null;
}

export interface StageSystemDomainInput {
  expectedSetupVersion: number;
  hostPlan: DomainHostPlan;
  idempotencyKey: string;
}

export interface VersionedSystemDomainMutationInput {
  expectedSetupVersion: number;
  idempotencyKey: string;
}

export interface AttachSystemDomainCertificateInput extends VersionedSystemDomainMutationInput {
  certificate: SystemDomainCertificate;
}

export interface SystemDomainMutationResult {
  setupVersion: number;
  operationId: string;
  status: SystemDomainStatusResult;
}
