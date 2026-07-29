import type {
  CustomDomainCheckStatus,
  CustomDomainDnsRecordPurpose,
  CustomDomainDnsRecordType,
} from '@compartment/contracts';
import { normalizeDnsHostname } from '@compartment/utils';
import { getDomain } from 'tldts';
import { hashToken } from '../lib/tokens';
import {
  buildCompartmentDomainOwnershipRecordName,
  buildCompartmentDomainOwnershipValue,
} from './domain-ownership-dns.service';
import { resolveCnameRecords, resolveTxtValues } from './domain-dns-resolution.service';
import { hasFlattenedAddressMatch } from './domain-dns-binding.service';
import type {
  CustomDomainDnsInput,
  CustomDomainDnsRecordInstruction,
  CustomDomainDnsRecords,
  CustomDomainDnsVerificationInput,
  CustomDomainDnsVerificationResult,
} from './custom-domain-dns.service.types';

const ownershipPurpose: CustomDomainDnsRecordPurpose = 'ownership';
const routingPurpose: CustomDomainDnsRecordPurpose = 'routing';

export function buildCustomDomainDnsRecords(input: CustomDomainDnsInput): CustomDomainDnsRecords {
  return [buildOwnershipDnsRecord(input), ...buildRoutingDnsRecords(input)];
}

export async function verifyCustomDomainDns(
  input: CustomDomainDnsVerificationInput,
): Promise<CustomDomainDnsVerificationResult> {
  const ownershipStatus: CustomDomainCheckStatus = await verifyOwnershipRecord(input);
  const routingStatus: CustomDomainCheckStatus = await verifyRoutingRecords(input);

  return {
    failureMessage: readFailureMessage(ownershipStatus, routingStatus),
    ownershipStatus,
    routingStatus,
  };
}

function buildOwnershipDnsRecord(input: CustomDomainDnsInput): CustomDomainDnsRecordInstruction {
  return {
    groupId: 'ownership',
    name: buildCompartmentDomainOwnershipRecordName(input.host),
    purpose: ownershipPurpose,
    recordType: 'TXT',
    required: true,
    value: buildCompartmentDomainOwnershipValue(input.domainId),
  };
}

function buildRoutingDnsRecords(input: CustomDomainDnsInput): CustomDomainDnsRecordInstruction[] {
  if (
    input.hostPlan.domainKind === 'managed' ||
    (input.hostPlan.domainKind === 'custom' && input.hostPlan.tlsMode === 'external')
  ) {
    return buildCanonicalHostRoutingRecords(input);
  }

  return [];
}

function buildCanonicalHostRoutingRecords(input: CustomDomainDnsInput): CustomDomainDnsRecordInstruction[] {
  if (!isApexHost(input.host)) {
    return [buildRoutingDnsRecord(input.host, 'CNAME', input.canonicalRouteHost, true)];
  }

  return [buildRoutingDnsRecord(input.host, 'APEX_ALIAS', input.canonicalRouteHost, false)];
}

function buildRoutingDnsRecord(
  host: string,
  recordType: CustomDomainDnsRecordType,
  value: string,
  required: boolean,
): CustomDomainDnsRecordInstruction {
  return {
    groupId: 'routing',
    name: host,
    purpose: routingPurpose,
    recordType,
    required,
    value,
  };
}

async function verifyOwnershipRecord(input: CustomDomainDnsVerificationInput): Promise<'invalid' | 'valid'> {
  const txtValues: string[] = await resolveTxtValues(buildCompartmentDomainOwnershipRecordName(input.host));

  return txtValues.some(
    (value: string): boolean => hashToken(value, input.config.sessionSecret) === input.verificationTokenHash,
  )
    ? 'valid'
    : 'invalid';
}

async function verifyRoutingRecords(input: CustomDomainDnsVerificationInput): Promise<'invalid' | 'valid'> {
  if (
    input.hostPlan.domainKind === 'managed' ||
    (input.hostPlan.domainKind === 'custom' && input.hostPlan.tlsMode === 'external')
  ) {
    return await verifyCanonicalHostRoutingRecords(input);
  }

  return 'invalid';
}

async function verifyCanonicalHostRoutingRecords(
  input: CustomDomainDnsVerificationInput,
): Promise<'invalid' | 'valid'> {
  if (isApexHost(input.host)) {
    if ((await resolveCnameRecords(input.host)).length > 0) {
      return 'invalid';
    }

    return (await hasFlattenedAddressMatch(input.host, input.canonicalRouteHost)) ? 'valid' : 'invalid';
  }
  if (await hasCanonicalCname(input.host, input.canonicalRouteHost)) {
    return 'valid';
  }

  return 'invalid';
}

async function hasCanonicalCname(host: string, canonicalRouteHost: string): Promise<boolean> {
  const cnameRecords: string[] = await resolveCnameRecords(host);

  return cnameRecords.some((record: string): boolean => normalizeDnsHostname(record) === canonicalRouteHost);
}

function isApexHost(host: string): boolean {
  const normalizedHost: string = normalizeDnsHostname(host);

  return getDomain(normalizedHost, { allowPrivateDomains: true }) === normalizedHost;
}

function readFailureMessage(ownershipStatus: 'invalid' | 'valid', routingStatus: 'invalid' | 'valid'): string | null {
  if (ownershipStatus === 'valid' && routingStatus === 'valid') {
    return null;
  }
  if (ownershipStatus !== 'valid' && routingStatus !== 'valid') {
    return 'Ownership TXT and routing DNS records are not valid yet.';
  }
  if (ownershipStatus !== 'valid') {
    return 'Ownership TXT record is not valid yet.';
  }

  return 'Routing DNS records are not valid yet.';
}
