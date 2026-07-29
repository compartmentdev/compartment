import type { DomainHostPlan } from './system-domain.contract';

export const controlPlaneSubdomainLabel: string = 'console';
const appWildcardProbeSubdomainLabel: string = 'compartment-domain-probe';

export function isOperatorManagedDomainHostPlan(hostPlan: DomainHostPlan): boolean {
  return hostPlan.domainKind === 'custom' && hostPlan.tlsMode === 'external';
}

export function buildControlPlaneHost(baseDomain: string): string {
  return `${controlPlaneSubdomainLabel}.${baseDomain}`;
}

export function buildDomainWildcardHost(baseDomain: string): string {
  return `*.${baseDomain}`;
}

export function buildDomainProbeHost(baseDomain: string): string {
  return `${appWildcardProbeSubdomainLabel}.${baseDomain}`;
}
