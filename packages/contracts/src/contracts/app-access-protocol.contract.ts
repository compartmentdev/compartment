import { z } from 'zod';
import type { ContractSchema } from './schema.types';

export interface AppAccessBrowserFlowTarget {
  host: string;
  path: string;
  state: string;
}

export const compartmentSessionCookieName: string = '__Host-compartment_session';
export const compartmentCliLoginAttemptCookieName: string = '__Host-compartment_cli_login_attempt';
export const compartmentCsrfCookieName: string = '__Host-compartment_csrf';
export const compartmentCsrfHeaderName: string = 'X-Compartment-CSRF';
export const compartmentAppSessionCookieName: string = '__Host-compartment_app_session';
type CompartmentReservedCookieNamePrefix = '__Host-compartment_' | '__Secure-compartment_' | 'compartment_';
export const compartmentReservedCookieNamePrefixes: readonly CompartmentReservedCookieNamePrefix[] = [
  '__Host-compartment_',
  '__Secure-compartment_',
  'compartment_',
];
const compartmentAppFlowCookieNamePrefix: string = '__Host-compartment_app_flow_';
export const appAccessFlowTtlSeconds: number = 5 * 60;
export const compartmentAppCallbackPathname: string = '/_compartment/callback';
export const compartmentDomainProbePathname: string = '/_compartment/domain/probe';
export const compartmentAppLogoutPathname: string = '/_compartment/logout';
export const compartmentInternalAppAccessExchangePathname: string = '/internal/app-access/exchange';
export const compartmentInternalAppAccessLogoutPathname: string = '/internal/app-access/logout';
export const compartmentInternalAppAccessSessionsRevokePathname: string = '/internal/app-access/sessions/revoke';
export const compartmentInternalAppAccessStatePathname: string = '/internal/app-access/state';
export const compartmentIngressAuthorizePathname: string = '/internal/ingress/authorize';
export const compartmentOnDemandTlsAskPathname: string = '/internal/tls/ask';
export const compartmentAccessModeHeaderName: string = 'X-Compartment-Access-Mode';
export const compartmentOrganizationIdHeaderName: string = 'X-Compartment-Organization-Id';
export const compartmentOrganizationSlugHeaderName: string = 'X-Compartment-Organization-Slug';
export const compartmentPrincipalEmailHeaderName: string = 'X-Compartment-Principal-Email';
export const compartmentPrincipalIdHeaderName: string = 'X-Compartment-Principal-Id';
export const compartmentPrincipalTypeHeaderName: string = 'X-Compartment-Principal-Type';
export const compartmentProxyPathHeaderName: string = 'X-Compartment-Proxy-Path';
export const compartmentUpstreamHostHeaderName: string = 'X-Compartment-Upstream-Host';
export const compartmentUpstreamPortHeaderName: string = 'X-Compartment-Upstream-Port';
export const compartmentIngressAuthorizeResponseHeaderNames: readonly string[] = [
  compartmentAccessModeHeaderName,
  compartmentOrganizationIdHeaderName,
  compartmentOrganizationSlugHeaderName,
  compartmentPrincipalEmailHeaderName,
  compartmentPrincipalIdHeaderName,
  compartmentPrincipalTypeHeaderName,
  compartmentProxyPathHeaderName,
  compartmentUpstreamHostHeaderName,
  compartmentUpstreamPortHeaderName,
];
const appAccessFlowStatePattern: RegExp = /^[A-Za-z0-9_-]+$/;
export const appAccessFlowStateSchema: z.ZodString = z.string().min(1).regex(appAccessFlowStatePattern);

export function readCompartmentAppFlowCookieName(state: string): string {
  return `${compartmentAppFlowCookieNamePrefix}${state}`;
}

export const appAccessBrowserFlowTargetSchema: ContractSchema<AppAccessBrowserFlowTarget> = z
  .object({
    host: z.string().min(1),
    path: z.string().min(1),
    state: appAccessFlowStateSchema,
  })
  .strict();
