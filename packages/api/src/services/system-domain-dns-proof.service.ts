import {
  buildControlPlaneHost,
  buildDomainWildcardHost,
  buildDomainProbeHost,
  type DomainDnsRecord,
  type DomainDnsRecordPurpose,
  type DomainDnsRecordType,
  type ManagedDomainTarget,
} from '@compartment/contracts';
import type { ApiPublicIngressConfig } from '../config';
import {
  buildCompartmentDomainOwnershipRecordName,
  buildCompartmentDomainOwnershipValue,
} from './domain-ownership-dns.service';
import { isUnsafePublicIpAddress } from '@compartment/utils';
import {
  matchesPublicIngressAddressBinding,
  resolveDirectDomainBindingAnswers,
  type DirectDomainBindingAnswers,
} from './domain-dns-binding.service';
import { resolveTxtValues } from './domain-dns-resolution.service';
import type { DomainCheckFailure, DomainCheckResult } from './system-domain-check.service.types';

const ownershipGroupId: string = 'ownership';
const ownershipPurpose: DomainDnsRecordPurpose = 'ownership';
const routingGroupId: string = 'routing';
const routingPurpose: DomainDnsRecordPurpose = 'routing';

interface SystemDomainDnsProofInput {
  pendingBaseDomain: string;
  pendingOperationId: string;
  publicIngressConfig: ApiPublicIngressConfig;
}

export function buildRequiredSystemDomainDnsRecords(input: SystemDomainDnsProofInput): DomainDnsRecord[] {
  return [
    buildSystemDomainOwnershipDnsRecord(input.pendingBaseDomain, input.pendingOperationId),
    ...buildDirectRoutingDnsRecords(input.pendingBaseDomain, input.publicIngressConfig),
  ];
}

export async function verifySystemDomainDnsProof(input: SystemDomainDnsProofInput): Promise<DomainCheckResult> {
  const ingressConfigFailure: DomainCheckFailure | null = verifyPublicIngressConfigured(input.publicIngressConfig);
  if (ingressConfigFailure !== null) {
    return { failure: ingressConfigFailure };
  }
  const ownershipFailure: DomainCheckFailure | null = await verifyOwnershipDnsRecord(input);
  if (ownershipFailure !== null) {
    return { failure: ownershipFailure };
  }

  return {
    failure: await verifyRoutingDnsBinding(input),
  };
}

function buildSystemDomainOwnershipDnsRecord(baseDomain: string, operationId: string): DomainDnsRecord {
  return {
    groupId: ownershipGroupId,
    name: buildCompartmentDomainOwnershipRecordName(baseDomain),
    purpose: ownershipPurpose,
    recordType: 'TXT',
    required: true,
    value: buildCompartmentDomainOwnershipValue(operationId),
  };
}

function buildDirectRoutingDnsRecords(
  baseDomain: string,
  publicIngressConfig: ApiPublicIngressConfig,
): DomainDnsRecord[] {
  const records: DomainDnsRecord[] = [];
  for (const host of [buildControlPlaneHost(baseDomain), buildDomainWildcardHost(baseDomain)]) {
    for (const target of publicIngressConfig.targets) {
      records.push(buildRoutingDnsRecord(host, target.type === 'hostname' ? 'CNAME' : target.type, target.value));
    }
  }

  return records;
}

function buildRoutingDnsRecord(name: string, recordType: DomainDnsRecordType, value: string): DomainDnsRecord {
  return {
    groupId: routingGroupId,
    name,
    purpose: routingPurpose,
    recordType,
    required: true,
    value,
  };
}

async function verifyOwnershipDnsRecord(input: SystemDomainDnsProofInput): Promise<DomainCheckFailure | null> {
  const recordName: string = buildCompartmentDomainOwnershipRecordName(input.pendingBaseDomain);
  const expectedValue: string = buildCompartmentDomainOwnershipValue(input.pendingOperationId);
  const txtValues: string[] = await resolveTxtValues(recordName);
  if (txtValues.includes(expectedValue)) {
    return null;
  }

  return {
    code: 'dns_ownership_invalid',
    message: `Ownership TXT ${recordName} must equal ${expectedValue}.`,
  };
}

async function verifyRoutingDnsBinding(input: SystemDomainDnsProofInput): Promise<DomainCheckFailure | null> {
  for (const host of [buildControlPlaneHost(input.pendingBaseDomain), buildDomainProbeHost(input.pendingBaseDomain)]) {
    const failure: DomainCheckFailure | null = await verifyDirectAddressBinding(host, input.publicIngressConfig);
    if (failure !== null) {
      return failure;
    }
  }

  return null;
}

async function verifyDirectAddressBinding(
  host: string,
  publicIngressConfig: ApiPublicIngressConfig,
): Promise<DomainCheckFailure | null> {
  const answers: DirectDomainBindingAnswers = await resolveDirectDomainBindingAnswers(host);
  const hostnameTargets: ManagedDomainTarget[] = publicIngressConfig.targets.filter(
    (target: ManagedDomainTarget): boolean => target.type === 'hostname',
  );
  if (hostnameTargets.length > 0) {
    return verifyHostnameBinding(host, answers.cnameRecords, hostnameTargets);
  }
  if (answers.cnameRecords.length > 0) {
    return createIndirectBindingFailure(host);
  }
  const unsafeAddress: string | undefined = findUnsafeResolvedAddress(answers.ipv4Records, answers.ipv6Records);
  if (unsafeAddress !== undefined) {
    return createUnsafeBindingFailure(host, unsafeAddress);
  }
  if (matchesPublicIngressAddressBinding(publicIngressConfig, answers)) {
    return null;
  }

  return createInvalidBindingFailure(host);
}

function verifyHostnameBinding(
  host: string,
  cnameRecords: string[],
  hostnameTargets: ManagedDomainTarget[],
): DomainCheckFailure | null {
  const expectedHostnames: Set<string> = new Set<string>(
    hostnameTargets.map((target: ManagedDomainTarget): string => target.value),
  );
  return cnameRecords.some((record: string): boolean => expectedHostnames.has(record))
    ? null
    : createInvalidBindingFailure(host);
}

function findUnsafeResolvedAddress(ipv4Records: string[], ipv6Records: string[]): string | undefined {
  return [...ipv4Records, ...ipv6Records].find(isUnsafePublicIpAddress);
}

function createIndirectBindingFailure(host: string): DomainCheckFailure {
  return {
    code: 'dns_binding_indirect',
    message: `DNS for ${host} must use direct A/AAAA records instead of CNAME.`,
  };
}

function createUnsafeBindingFailure(host: string, unsafeAddress: string): DomainCheckFailure {
  return {
    code: 'dns_binding_unsafe',
    message: `DNS for ${host} resolves to unsafe address ${unsafeAddress}.`,
  };
}

function createInvalidBindingFailure(host: string): DomainCheckFailure {
  return {
    code: 'dns_binding_invalid',
    message: `DNS for ${host} must point at this installation public ingress.`,
  };
}

function verifyPublicIngressConfigured(publicIngressConfig: ApiPublicIngressConfig): DomainCheckFailure | null {
  if (publicIngressConfig.targets.length > 0) {
    return null;
  }

  return {
    code: 'dns_binding_invalid',
    message: 'System domain verification requires at least one public ingress target.',
  };
}
