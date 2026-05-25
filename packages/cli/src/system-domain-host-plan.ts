import {
  isCustomCertificateDomainHostPlan,
  isCustomHttpDomainHostPlan,
  type DomainHostPlan,
} from '@compartment/contracts';
import type { ManagedDomainInstallState } from './managed-domain.types';
import type { SetSelfHostedSystemDomainInput } from './system-domain.types';

export function buildCustomSystemDomainHostPlan(input: SetSelfHostedSystemDomainInput): DomainHostPlan {
  if (input.tlsMode === 'custom-cert') {
    return {
      baseDomain: input.baseDomain,
      caddyMode: 'custom-cert',
      domainKind: 'custom',
      publicScheme: 'https',
      tlsMode: 'custom-cert',
    };
  }

  return {
    baseDomain: input.baseDomain,
    caddyMode: 'custom-http',
    domainKind: 'custom',
    publicScheme: input.publicScheme,
    tlsMode: 'external',
  };
}

export function buildManagedSystemDomainHostPlan(managedDomain: ManagedDomainInstallState): DomainHostPlan {
  return {
    baseDomain: managedDomain.baseDomain,
    caddyMode: 'managed',
    domainKind: 'managed',
    publicScheme: 'https',
    tlsMode: 'broker-dns01',
  };
}

export function isCustomHttpHostPlan(hostPlan: DomainHostPlan): boolean {
  return isCustomHttpDomainHostPlan(hostPlan);
}

export function isCustomCertHostPlan(hostPlan: DomainHostPlan): boolean {
  return isCustomCertificateDomainHostPlan(hostPlan);
}
