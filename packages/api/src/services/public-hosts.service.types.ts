import type { DnsRecordInstruction } from '@compartment/contracts';

export interface PublicIngressPortConfig {
  publicProtocol: 'http' | 'https';
  publicHttpPort: number;
  publicHttpsPort: number;
}

export interface RuntimePublicSettingsConfig extends PublicIngressPortConfig {
  baseDomain: string;
}

export interface InstallationHostPlan {
  baseDomain: string;
  dnsRecords: DnsRecordInstruction[];
  compartmentUrl: string;
}

export interface CanonicalRouteHostInput {
  baseDomain: string;
  environmentName: string;
  includeServiceLabel: boolean;
  organizationId: string;
  projectName: string;
  serviceName: string;
}

export interface RouteCollisionInput extends CanonicalRouteHostInput {
  existingHosts: string[];
}

export interface PublicRouteUrlInput {
  host: string;
}

export interface InstallationPublicSettings {
  baseDomain: string;
  compartmentUrl: string;
}
