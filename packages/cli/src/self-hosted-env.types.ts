import type { ManagedDomainInstallState } from './managed-domain.types';

export interface SelfHostedImageRefs {
  apiImage: string;
  caddyImage: string;
  edgeImage: string;
  runtimeProbeImage: string;
  workerImage: string;
}

export interface SelfHostedRuntimeSelection {
  imageRefs: SelfHostedImageRefs;
  nodeVersion: string;
}

export interface BuildSelfHostedEnvironmentInput {
  acmeEmail: string;
  baseDomain: string;
  dockerWorkDirectory: string;
  edgeToken: string;
  artifactRegistryReadPassword: string;
  artifactRegistryReadUsername: string;
  artifactRegistryWritePassword: string;
  artifactRegistryWriteUsername: string;
  managedDomain?: ManagedDomainInstallState | undefined;
  postgresPassword: string;
  publicHttpPort: number;
  publicHttpsPort: number;
  publicIngressIpv4: string;
  publicIngressIpv6: string;
  runtimeControlToken: string;
  runtimeSelection: SelfHostedRuntimeSelection;
  sessionSecret: string;
  nodeAgentSocketPath: string;
  systemApiSocketPath: string;
  systemToken: string;
  templateText: string;
  variablesMasterKey: string;
}

export interface BuildUpdatedSelfHostedEnvironmentInput extends BuildSelfHostedEnvironmentInput {
  currentValues: Record<string, string>;
}

export interface RenderedSelfHostedEnvironment {
  text: string;
  values: Record<string, string>;
}
