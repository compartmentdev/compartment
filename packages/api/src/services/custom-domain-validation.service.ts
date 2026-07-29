import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';
import { hasText } from '@compartment/utils';
import type { DomainHostPlan } from '@compartment/contracts';
import { parse } from 'tldts';
import type { ApiConfig, ApiPublicIngressConfig } from '../config';
import { createInvalidCustomDomainError } from '../errors/api-business-error';
import { readRuntimeDomainHostPlan } from './system-domain-runtime.service';

interface ParsedCustomDomainHost {
  readonly domain: string | null;
  readonly isIcann: boolean | null;
  readonly isPrivate: boolean | null;
}

export function normalizeCustomDomainHost(value: string, config: ApiConfig): string {
  const rawHost: string = value.trim().replace(/\.$/u, '').toLowerCase();
  if (!isRawCustomDomainHostInput(rawHost)) {
    throw createInvalidCustomDomainError('Custom domain must be a valid non-local DNS hostname.');
  }

  const host: string = domainToASCII(rawHost);
  if (!isValidCustomDomainHost(host)) {
    throw createInvalidCustomDomainError('Custom domain must be a valid non-local DNS hostname.');
  }
  if (!isRegistrableCustomDomainHost(host)) {
    throw createInvalidCustomDomainError('Custom domain must include a registrable domain, not only a public suffix.');
  }
  if (host === config.baseDomain || host.endsWith(`.${config.baseDomain}`) || host === config.controlPlaneHost) {
    throw createInvalidCustomDomainError('Custom domain must not be under the active compartment base domain.');
  }

  return host;
}

export function assertRuntimeSupportsCustomDomains(
  config: ApiConfig,
  publicIngressConfig: ApiPublicIngressConfig,
): void {
  const hostPlan: DomainHostPlan = readRuntimeDomainHostPlan();
  if (config.publicProtocol !== 'https' || config.publicHttpsPort !== 443) {
    throw createInvalidCustomDomainError('Custom domains require public HTTPS on port 443.');
  }
  if (hostPlan.domainKind === 'managed') {
    assertManagedRuntimeHasPublicIngress(publicIngressConfig);
    return;
  }
  if (hostPlan.domainKind === 'custom' && hostPlan.tlsMode === 'external') {
    return;
  }

  throw createInvalidCustomDomainError('Custom app domains require a managed or issuer-backed system domain.');
}

function isValidCustomDomainHost(host: string): boolean {
  return (
    hasText(host) &&
    host.includes('.') &&
    !host.includes('_') &&
    !host.includes('*') &&
    !host.includes('/') &&
    !host.includes(':') &&
    !host.endsWith('.localhost') &&
    host !== 'localhost' &&
    isIP(host) === 0 &&
    host.split('.').every(isValidDnsLabel)
  );
}

function isRawCustomDomainHostInput(value: string): boolean {
  return !value.includes('/') && !value.includes('?') && !value.includes('#');
}

function isValidDnsLabel(label: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label);
}

function isRegistrableCustomDomainHost(host: string): boolean {
  const result: ParsedCustomDomainHost = parse(host, { allowPrivateDomains: true });

  return result.domain !== null && result.isIcann === true && result.isPrivate !== true;
}

function assertManagedRuntimeHasPublicIngress(publicIngressConfig: ApiPublicIngressConfig): void {
  if (publicIngressConfig.targets.length > 0) {
    return;
  }

  throw createInvalidCustomDomainError('Managed custom app domains require a public ingress target.');
}
