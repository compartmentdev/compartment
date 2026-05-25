import type { DomainCaddyMode } from '@compartment/contracts';

export const selfHostedCustomCertCaddyTlsMode: DomainCaddyMode = 'custom-cert';
export const selfHostedCustomHttpCaddyTlsMode: DomainCaddyMode = 'custom-http';
export const selfHostedInternalCaddyTlsMode: DomainCaddyMode = 'internal';
export const selfHostedManagedCaddyTlsMode: DomainCaddyMode = 'managed';
export const selfHostedManagedAcmeCaUrl: string = 'https://acme.zerossl.com/v2/DV90';
export const selfHostedCustomTlsDirectory: string = '/etc/compartment/tls';
