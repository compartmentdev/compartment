import type { DomainHostPlan, DomainKind, DomainTlsMode } from '@compartment/contracts';
import type { ApiConfig } from '../config';
import { getApiConfig } from '../runtime/runtime-access';
import { normalizeAndValidateRuntimeDomainHostPlan } from './system-domain-validation.service';

export function readRuntimeDomainHostPlan(): DomainHostPlan {
  return normalizeAndValidateRuntimeDomainHostPlan(buildRuntimeDomainHostPlan(getApiConfig()));
}

function buildRuntimeDomainHostPlan(config: ApiConfig): DomainHostPlan {
  const domainKind: DomainKind = readRuntimeDomainKind(config);

  return {
    baseDomain: config.baseDomain,
    caddyMode: config.caddyTlsMode,
    domainKind,
    publicScheme: config.publicProtocol,
    tlsMode: readRuntimeTlsMode(config),
  };
}

function readRuntimeDomainKind(config: ApiConfig): DomainKind {
  if (config.caddyTlsMode === 'managed') {
    return 'managed';
  }
  if (isLocalBaseDomain(config.baseDomain)) {
    return 'local';
  }

  return 'custom';
}

function readRuntimeTlsMode(config: ApiConfig): DomainTlsMode {
  switch (config.caddyTlsMode) {
    case 'custom-cert':
      return 'custom-cert';
    case 'custom-http':
      return 'external';
    case 'internal':
      return 'internal';
    case 'managed':
      return 'broker-dns01';
  }
}

function isLocalBaseDomain(value: string): boolean {
  return value === 'localhost' || value.endsWith('.localhost') || value === '127.0.0.1.sslip.io';
}
