import type { ApiRuntimeConfig } from './api-runtime-config';
import type { ApiAuthThrottleConfig } from './auth-throttle-config';

export interface ApiConfig extends ApiRuntimeConfig {
  baseDomain: string;
  bindHost: string;
  tlsMode: 'broker-dns01' | 'internal' | 'issuer';
  controlPlaneHost: string;
  databaseUrl: string;
  deploymentInfrastructureTimeoutMs: number;
  edgeToken: string;
  edgeUrl: string;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  metricsPort: number;
  managedDomainAcmeDnsToken?: string | null;
  managedDomainBrokerUrl?: string | null;
  trustedOutboundHosts: string[];
  sessionSecret: string;
  sessionTtlMs: number;
  signupEnabled: boolean;
  port: number;
  publicProtocol: 'http' | 'https';
  publicHttpPort: number;
  publicHttpsPort: number;
  productLogIngestToken?: string | null;
  throttle: ApiAuthThrottleConfig;
  systemApiSocketPath: string;
  systemToken: string;
  tenantSecretsKek: Buffer;
  tenantSecretsPreviousKek?: Buffer | undefined;
  variablesMasterKey: Buffer;
  runtimeControlToken: string;
}
