import type { DomainCertificateMetadata, DomainHostPlan } from './system-domain.contract';

export const controlPlaneSubdomainLabel: string = 'console';
const appWildcardProbeSubdomainLabel: string = 'compartment-domain-probe';

export function buildRequiredDomainCertificateDnsNames(hostPlan: DomainHostPlan): string[] {
  return [buildControlPlaneHost(hostPlan.baseDomain), buildDomainWildcardHost(hostPlan.baseDomain)];
}

export function domainCertificateMetadataCoversHostPlan(
  metadata: DomainCertificateMetadata,
  hostPlan: DomainHostPlan,
): boolean {
  const certificateNames: string[] = metadata.dnsNames.map(normalizeCertificateDnsName);
  const controlPlaneHost: string = buildControlPlaneHost(hostPlan.baseDomain);
  const appWildcardName: string = normalizeCertificateDnsName(buildDomainWildcardHost(hostPlan.baseDomain));

  return (
    certificateNames.some((certificateName: string): boolean =>
      certificateDnsNameCoversHost(certificateName, controlPlaneHost),
    ) && certificateNames.includes(appWildcardName)
  );
}

export function isCustomCertificateDomainHostPlan(hostPlan: DomainHostPlan): boolean {
  return hostPlan.domainKind === 'custom' && hostPlan.tlsMode === 'custom-cert' && hostPlan.publicScheme === 'https';
}

export function isCustomHttpDomainHostPlan(hostPlan: DomainHostPlan): boolean {
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

function certificateDnsNameCoversHost(certificateName: string, host: string): boolean {
  const normalizedHost: string = normalizeCertificateDnsName(host);
  if (!certificateName.startsWith('*.')) {
    return certificateName === normalizedHost;
  }

  const baseDomain: string = certificateName.slice(2);
  return (
    normalizedHost.endsWith(`.${baseDomain}`) && normalizedHost.split('.').length === baseDomain.split('.').length + 1
  );
}

function normalizeCertificateDnsName(value: string): string {
  return value.trim().replace(/\.$/u, '').toLowerCase();
}
