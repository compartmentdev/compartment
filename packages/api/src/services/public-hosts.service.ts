import { createHash } from 'node:crypto';
import {
  buildControlPlaneHost,
  buildDomainWildcardHost,
  controlPlaneSubdomainLabel,
  defaultCompartmentEnvironmentName,
  type DnsRecordInstruction,
} from '@compartment/contracts';
import { hasText, isValidDnsHostname, slugifyText } from '@compartment/utils';
import { createInvalidBaseDomainError } from '../errors/api-business-error';
import { buildPublicRouteHost, readPublicRouteSubdomain } from '../lib/public-route-host';
import type {
  CanonicalRouteHostInput,
  InstallationHostPlan,
  InstallationPublicSettings,
  PublicIngressPortConfig,
  PublicRouteUrlInput,
  RuntimePublicSettingsConfig,
  RouteCollisionInput,
} from './public-hosts.service.types';

const maxDnsLabelLength: number = 63;
export function buildInstallationHostPlan(baseDomain: string, config: PublicIngressPortConfig): InstallationHostPlan {
  const normalizedBaseDomain: string = normalizeBaseDomain(baseDomain);

  return {
    baseDomain: normalizedBaseDomain,
    dnsRecords: buildDnsRecordInstructions(normalizedBaseDomain),
    compartmentUrl: buildCompartmentPublicUrl(normalizedBaseDomain, config),
  };
}

export function buildRuntimePublicSettings(config: RuntimePublicSettingsConfig): InstallationPublicSettings {
  return {
    baseDomain: config.baseDomain,
    compartmentUrl: buildPublicRouteUrl({ host: buildControlPlaneHost(config.baseDomain) }, config),
  };
}

export function buildCanonicalRouteHost(input: RouteCollisionInput): string {
  const existingHosts: Set<string> = new Set<string>([...input.existingHosts, buildControlPlaneHost(input.baseDomain)]);
  const candidateHost: string = buildCanonicalRouteHostCandidate(input);
  if (!existingHosts.has(candidateHost)) {
    return candidateHost;
  }

  return buildAvailableCollisionHost(candidateHost, existingHosts, input);
}

function normalizeBaseDomain(value: string): string {
  const normalizedValue: string = value.trim().toLowerCase();
  if (!isValidDnsHostname(normalizedValue) || !hasText(normalizedValue)) {
    throw createInvalidBaseDomainError();
  }

  return normalizedValue;
}

function buildDnsRecordInstructions(baseDomain: string): DnsRecordInstruction[] {
  return [
    {
      host: buildDomainWildcardHost(baseDomain),
      purpose: 'Compartment control plane and hosted application entrypoints',
      type: 'A/AAAA-or-CNAME',
    },
  ];
}

function buildCompartmentPublicUrl(baseDomain: string, config: PublicIngressPortConfig): string {
  return buildPublicRouteUrl(
    {
      host: buildControlPlaneHost(baseDomain),
    },
    config,
  );
}

export function buildPublicRouteUrl(input: PublicRouteUrlInput, config: PublicIngressPortConfig): string {
  const protocol: 'http' | 'https' = config.publicProtocol;
  const port: number = readConfiguredPublicPort(protocol, config);
  const portSuffix: string = readPublicPortSuffix(protocol, port);

  return `${protocol}://${input.host}${portSuffix}`;
}

function buildCanonicalRouteHostCandidate(input: CanonicalRouteHostInput): string {
  return buildPublicRouteHost(input.baseDomain, buildCanonicalAppLabel(input));
}

function buildCanonicalAppLabel(input: CanonicalRouteHostInput): string {
  const environmentSegment: string | null = readEnvironmentRouteSegment(input.environmentName);

  return buildRouteHostLabel([
    input.includeServiceLabel ? input.serviceName : null,
    input.projectName,
    environmentSegment,
  ]);
}

function buildAvailableCollisionHost(
  candidateHost: string,
  existingHosts: Set<string>,
  input: CanonicalRouteHostInput,
): string {
  let collisionAttempt: number = 0;
  while (collisionAttempt <= existingHosts.size) {
    const collisionHost: string = appendRouteCollisionSuffix(
      candidateHost,
      input.baseDomain,
      createCollisionSuffix(input, collisionAttempt),
    );
    if (!existingHosts.has(collisionHost)) {
      return collisionHost;
    }

    collisionAttempt += 1;
  }

  throw new Error('Could not allocate a unique public route host.');
}

function createCollisionSuffix(input: CanonicalRouteHostInput, collisionAttempt: number): string {
  const collisionSeedParts: string[] = [
    input.organizationId,
    input.projectName,
    input.environmentName,
    input.serviceName,
  ];
  if (collisionAttempt > 0) {
    collisionSeedParts.push(String(collisionAttempt));
  }

  return createStableRouteSuffix(collisionSeedParts.join(':'));
}

function appendRouteCollisionSuffix(host: string, baseDomain: string, suffix: string): string {
  const routeSubdomain: string | null = readPublicRouteSubdomain(host, baseDomain);
  if (routeSubdomain === null) {
    return host;
  }

  return buildPublicRouteHost(baseDomain, appendDnsLabelSuffix(routeSubdomain, suffix));
}

function readEnvironmentRouteSegment(environmentName: string): string | null {
  if (environmentName === defaultCompartmentEnvironmentName) {
    return null;
  }

  return environmentName;
}

function buildRouteHostLabel(segments: (string | null)[]): string {
  const candidate: string = segments
    .map((segment: string | null): string => normalizeRouteSegment(segment))
    .filter(hasText)
    .join('-');
  if (candidate === '') {
    return 'app';
  }
  if (candidate === controlPlaneSubdomainLabel) {
    return 'app';
  }
  if (candidate.length <= maxDnsLabelLength) {
    return candidate;
  }

  return appendDnsLabelSuffix(candidate.slice(0, maxDnsLabelLength), createStableRouteSuffix(candidate));
}

function normalizeRouteSegment(value: string | null): string {
  if (value === null) {
    return '';
  }

  return slugifyText(value);
}

function appendDnsLabelSuffix(label: string, suffix: string): string {
  if (label.length < maxDnsLabelLength) {
    const nextLabel: string = `${label}-${suffix}`;
    if (nextLabel.length <= maxDnsLabelLength) {
      return nextLabel;
    }
  }

  const truncatedLabel: string = label.slice(0, maxDnsLabelLength - suffix.length - 1).replace(/-+$/u, '');

  return `${truncatedLabel}-${suffix}`;
}

function createStableRouteSuffix(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 6);
}

function readConfiguredPublicPort(protocol: 'http' | 'https', config: PublicIngressPortConfig): number {
  return protocol === 'http' ? config.publicHttpPort : config.publicHttpsPort;
}

function readPublicPortSuffix(protocol: 'http' | 'https', port: number): string {
  return port === readDefaultPublicPort(protocol) ? '' : `:${port}`;
}

function readDefaultPublicPort(protocol: 'http' | 'https'): number {
  return protocol === 'http' ? 80 : 443;
}
