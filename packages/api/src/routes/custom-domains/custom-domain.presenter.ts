import type {
  CreateCustomDomainResponse,
  CustomDomainDnsRecord,
  CustomDomainResponse,
  CustomDomainSummary,
  ListCustomDomainsResponse,
  RemoveCustomDomainResponse,
  VerifyCustomDomainResponse,
} from '@compartment/contracts';
import type { CustomDomainDnsRecordInstruction } from '../../services/custom-domain-dns.service.types';
import type {
  CustomDomainListResult,
  CustomDomainServiceDomain,
  CustomDomainServiceResult,
  RemovedCustomDomainResult,
} from '../../services/custom-domain.service.types';

export function presentCreateCustomDomainResponse(result: CustomDomainServiceResult): CreateCustomDomainResponse {
  return {
    dnsRecords: presentCustomDomainDnsRecords(result),
    domain: presentCustomDomainSummary(result.domain),
  };
}

export function presentVerifyCustomDomainResponse(result: CustomDomainServiceResult): VerifyCustomDomainResponse {
  const domain: CustomDomainSummary = presentCustomDomainSummary(result.domain);

  return {
    dnsRecords: presentCustomDomainDnsRecords(result),
    domain,
  };
}

export function presentCustomDomainResponse(result: CustomDomainServiceResult): CustomDomainResponse {
  return {
    domain: presentCustomDomainSummary(result.domain),
  };
}

export function presentListCustomDomainsResponse(result: CustomDomainListResult): ListCustomDomainsResponse {
  return {
    domains: result.domains.map(presentCustomDomainSummary),
  };
}

export function presentRemoveCustomDomainResponse(result: RemovedCustomDomainResult): RemoveCustomDomainResponse {
  return {
    host: result.host,
    removed: result.removed,
  };
}

function presentCustomDomainSummary(domain: CustomDomainServiceDomain): CustomDomainSummary {
  return {
    canonicalRouteHost: domain.canonicalRouteHost,
    createdAt: domain.createdAt.toISOString(),
    environmentName: domain.environmentName,
    failureMessage: domain.failureMessage,
    host: domain.host,
    lastCheckedAt: domain.lastCheckedAt?.toISOString() ?? null,
    ownershipStatus: domain.ownershipStatus,
    projectName: domain.projectName,
    routingStatus: domain.routingStatus,
    serviceName: domain.serviceName,
    status: domain.status,
    updatedAt: domain.updatedAt.toISOString(),
    verifiedAt: domain.verifiedAt?.toISOString() ?? null,
  };
}

function presentCustomDomainDnsRecords(result: CustomDomainServiceResult): CustomDomainDnsRecord[] {
  return result.dnsRecords.map(presentCustomDomainDnsRecord);
}

function presentCustomDomainDnsRecord(record: CustomDomainDnsRecordInstruction): CustomDomainDnsRecord {
  return {
    groupId: record.groupId,
    name: record.name,
    purpose: record.purpose,
    recordType: record.recordType,
    required: record.required,
    value: record.value,
  };
}
