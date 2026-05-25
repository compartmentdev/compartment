import { domainToASCII } from 'node:url';
import { isIP } from 'node:net';
import type { DomainHostPlan } from '@compartment/contracts';
import { hasText } from '@compartment/utils';
import { createInvalidDomainHostPlanError } from '../errors/api-business-error';

const hostLabelPattern: RegExp = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

export function normalizeAndValidatePendingDomainHostPlan(
  hostPlan: DomainHostPlan,
  activeBaseDomain: string,
): DomainHostPlan {
  const normalizedHostPlan: DomainHostPlan = normalizeDomainHostPlan(hostPlan);

  assertSupportedPendingDomainMatrix(normalizedHostPlan);
  assertValidHostPlanNames(normalizedHostPlan);
  assertCustomHostPlanDoesNotOverlapActiveDomain(normalizedHostPlan, activeBaseDomain);
  return normalizedHostPlan;
}

export function normalizeAndValidateRuntimeDomainHostPlan(hostPlan: DomainHostPlan): DomainHostPlan {
  const normalizedHostPlan: DomainHostPlan = normalizeDomainHostPlan(hostPlan);

  assertSupportedRuntimeDomainMatrix(normalizedHostPlan);
  assertValidHostPlanNames(normalizedHostPlan);
  return normalizedHostPlan;
}

function assertSupportedRuntimeDomainMatrix(hostPlan: DomainHostPlan): void {
  if (
    hostPlan.tlsMode === 'internal' &&
    hostPlan.publicScheme === 'http' &&
    hostPlan.caddyMode === 'internal' &&
    (hostPlan.domainKind === 'custom' || hostPlan.domainKind === 'local')
  ) {
    return;
  }

  if (
    hostPlan.domainKind === 'custom' &&
    hostPlan.tlsMode === 'external' &&
    hostPlan.publicScheme === 'http' &&
    hostPlan.caddyMode === 'custom-http'
  ) {
    return;
  }

  assertSupportedDomainMatrix(hostPlan);
}

function assertSupportedPendingDomainMatrix(hostPlan: DomainHostPlan): void {
  if (
    hostPlan.domainKind === 'custom' &&
    hostPlan.tlsMode === 'external' &&
    hostPlan.publicScheme === 'https' &&
    hostPlan.caddyMode === 'custom-http'
  ) {
    return;
  }
  if (
    hostPlan.domainKind === 'custom' &&
    hostPlan.tlsMode === 'custom-cert' &&
    hostPlan.publicScheme === 'https' &&
    hostPlan.caddyMode === 'custom-cert'
  ) {
    return;
  }

  const key: string = [hostPlan.domainKind, hostPlan.tlsMode, hostPlan.publicScheme, hostPlan.caddyMode].join('/');
  throw createInvalidDomainHostPlanError(`Unsupported pending domain/TLS combination: ${key}.`);
}

function assertSupportedDomainMatrix(hostPlan: DomainHostPlan): void {
  const key: string = [hostPlan.domainKind, hostPlan.tlsMode, hostPlan.publicScheme, hostPlan.caddyMode].join('/');
  const supportedKeys: Set<string> = new Set<string>([
    'managed/broker-dns01/https/managed',
    'custom/custom-cert/https/custom-cert',
    'custom/external/https/custom-http',
    'local/internal/https/internal',
  ]);

  if (!supportedKeys.has(key)) {
    throw createInvalidDomainHostPlanError(`Unsupported domain/TLS combination: ${key}.`);
  }
}

function assertValidHostPlanNames(hostPlan: DomainHostPlan): void {
  if (hostPlan.domainKind === 'local') {
    assertLocalBaseDomain(hostPlan.baseDomain);
    return;
  }

  assertPublicHost(hostPlan.baseDomain, 'baseDomain');
  if (hostPlan.domainKind === 'custom' && hostPlan.baseDomain.split('.').length <= 2) {
    throw createInvalidDomainHostPlanError(
      'custom baseDomain must use a delegated subdomain like customer.example.com.',
    );
  }
}

function assertCustomHostPlanDoesNotOverlapActiveDomain(hostPlan: DomainHostPlan, activeBaseDomain: string): void {
  if (hostPlan.domainKind !== 'custom') {
    return;
  }
  if (domainsOverlap(hostPlan.baseDomain, activeBaseDomain)) {
    throw createInvalidDomainHostPlanError('custom baseDomain must not overlap the active baseDomain.');
  }
}

function normalizeDomainHostPlan(hostPlan: DomainHostPlan): DomainHostPlan {
  return {
    ...hostPlan,
    baseDomain: normalizeDomainHost(hostPlan.baseDomain),
  };
}

function normalizeDomainHost(value: string): string {
  const trimmedValue: string = value.trim().replace(/\.$/u, '').toLowerCase();
  const asciiValue: string = domainToASCII(trimmedValue);
  if (!hasText(asciiValue)) {
    throw createInvalidDomainHostPlanError('Hostnames must be valid DNS names.');
  }
  return asciiValue;
}

function assertPublicHost(value: string, fieldName: string): void {
  if (isIP(value) !== 0 || value.includes(':') || value.includes('*') || value.includes('_')) {
    throw createInvalidDomainHostPlanError(`${fieldName} must be a DNS hostname.`);
  }
  assertDnsLabels(value, fieldName);
}

function assertDnsLabels(value: string, fieldName: string): void {
  const labels: string[] = value.split('.');
  if (labels.length < 2 || labels.some((label: string): boolean => !hostLabelPattern.test(label))) {
    throw createInvalidDomainHostPlanError(`${fieldName} must be a valid DNS hostname.`);
  }
}

function assertLocalBaseDomain(value: string): void {
  if (isLocalBaseDomain(value)) {
    return;
  }

  throw createInvalidDomainHostPlanError('local baseDomain must use localhost, *.localhost, or 127.0.0.1.sslip.io.');
}

function isLocalBaseDomain(value: string): boolean {
  return value === 'localhost' || value.endsWith('.localhost') || value === '127.0.0.1.sslip.io';
}

function domainsOverlap(firstDomain: string, secondDomain: string): boolean {
  return isEqualOrSubdomain(firstDomain, secondDomain) || isEqualOrSubdomain(secondDomain, firstDomain);
}

function isEqualOrSubdomain(host: string, baseDomain: string): boolean {
  return host === baseDomain || host.endsWith(`.${baseDomain}`);
}
