import type { ManagedDomainTarget } from '@compartment/contracts';
import type { ApiPublicIngressConfig } from '../config';
import { resolveAddressRecords, resolveCnameRecords } from './domain-dns-resolution.service';

export interface DirectDomainBindingAnswers {
  cnameRecords: string[];
  ipv4Records: string[];
  ipv6Records: string[];
}

export async function resolveDirectDomainBindingAnswers(host: string): Promise<DirectDomainBindingAnswers> {
  const [cnameRecords, ipv4Records, ipv6Records]: [string[], string[], string[]] = await Promise.all([
    resolveCnameRecords(host),
    resolveAddressRecords(host, 4),
    resolveAddressRecords(host, 6),
  ]);

  return {
    cnameRecords,
    ipv4Records,
    ipv6Records,
  };
}

export function matchesPublicIngressAddressBinding(
  publicIngressConfig: ApiPublicIngressConfig,
  answers: Pick<DirectDomainBindingAnswers, 'ipv4Records' | 'ipv6Records'>,
): boolean {
  const ipv4Targets: string[] = readAddressTargets(publicIngressConfig.targets, 'A');
  const ipv6Targets: string[] = readAddressTargets(publicIngressConfig.targets, 'AAAA');
  return (
    matchesExpectedAddressSet(ipv4Targets, answers.ipv4Records) &&
    matchesExpectedAddressSet(ipv6Targets, answers.ipv6Records)
  );
}

function readAddressTargets(targets: ManagedDomainTarget[], type: 'A' | 'AAAA'): string[] {
  return targets
    .filter((target: ManagedDomainTarget): boolean => target.type === type)
    .map((target: ManagedDomainTarget): string => target.value);
}

function matchesExpectedAddressSet(expectedAddresses: string[], records: string[]): boolean {
  const expected: Set<string> = new Set<string>(expectedAddresses);
  const actual: Set<string> = new Set<string>(records);
  return expected.size === actual.size && [...expected].every((address: string): boolean => actual.has(address));
}

export async function hasFlattenedAddressMatch(host: string, canonicalRouteHost: string): Promise<boolean> {
  const [hostIpv4, hostIpv6, canonicalIpv4, canonicalIpv6]: [string[], string[], string[], string[]] =
    await Promise.all([
      resolveAddressRecords(host, 4),
      resolveAddressRecords(host, 6),
      resolveAddressRecords(canonicalRouteHost, 4),
      resolveAddressRecords(canonicalRouteHost, 6),
    ]);

  return (
    (hostIpv4.length > 0 || hostIpv6.length > 0) &&
    hasOnlyCanonicalAddresses(hostIpv4, canonicalIpv4) &&
    hasOnlyCanonicalAddresses(hostIpv6, canonicalIpv6)
  );
}

function hasOnlyCanonicalAddresses(hostRecords: string[], canonicalRecords: string[]): boolean {
  if (hostRecords.length === 0) {
    return true;
  }
  if (canonicalRecords.length === 0) {
    return false;
  }

  const canonicalRecordSet: Set<string> = new Set<string>(canonicalRecords);

  return hostRecords.every((value: string): boolean => canonicalRecordSet.has(value));
}
