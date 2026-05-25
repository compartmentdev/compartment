import type { CustomDomainCheckStatus, CustomDomainState } from '@compartment/contracts';
import type { CustomDomainDnsRecordInstruction } from './custom-domain-dns.service.types';

export type CustomDomainServiceState = CustomDomainState;

export interface AddCustomDomainInput {
  environmentName?: string | undefined;
  host: string;
  organizationSlug: string;
  principalId: string;
  projectName: string;
  serviceName: string;
}

export interface ListCustomDomainsInput {
  environmentName?: string | undefined;
  organizationSlug: string;
  principalId: string;
  projectName?: string | undefined;
  serviceName?: string | undefined;
}

export interface CustomDomainHostInput {
  host: string;
  organizationSlug: string;
  principalId: string;
}

export interface CustomDomainServiceResult {
  dnsRecords: CustomDomainDnsRecordInstruction[];
  domain: CustomDomainServiceDomain;
}

export interface CustomDomainServiceDomain {
  canonicalRouteHost: string;
  createdAt: Date;
  environmentName: string;
  failureMessage: string | null;
  host: string;
  lastCheckedAt: Date | null;
  ownershipStatus: CustomDomainCheckStatus;
  projectName: string;
  routingStatus: CustomDomainCheckStatus;
  serviceName: string;
  status: CustomDomainServiceState;
  updatedAt: Date;
  verifiedAt: Date | null;
}

export interface CustomDomainListResult {
  domains: CustomDomainServiceDomain[];
}

export interface RemovedCustomDomainResult {
  host: string;
  removed: true;
}
