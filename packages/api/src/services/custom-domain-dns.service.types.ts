import type { CustomDomainCheckStatus, DomainDnsRecord, DomainHostPlan } from '@compartment/contracts';
import type { ApiPublicIngressConfig } from '../config';

export type CustomDomainDnsRecordInstruction = DomainDnsRecord;

export interface CustomDomainDnsConfig extends ApiPublicIngressConfig {
  sessionSecret: string;
}

export interface CustomDomainDnsInput {
  canonicalRouteHost: string;
  config: CustomDomainDnsConfig;
  domainId: string;
  host: string;
  hostPlan: DomainHostPlan;
}

export interface CustomDomainDnsVerificationInput extends CustomDomainDnsInput {
  verificationTokenHash: string;
}

export interface CustomDomainDnsVerificationResult {
  failureMessage: string | null;
  ownershipStatus: CustomDomainCheckStatus;
  routingStatus: CustomDomainCheckStatus;
}

export type CustomDomainDnsRecords = CustomDomainDnsRecordInstruction[];
