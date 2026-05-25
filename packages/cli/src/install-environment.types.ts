import type { SelfHostedRuntimeSelection } from './self-hosted-env.types';
import type { ManagedDomainInstallState } from './managed-domain.types';
import type { BundledAssets, StagedAssetPaths } from './runtime-assets.types';

export interface RenderPreparedInstallEnvironmentInput {
  acmeEmail: string;
  assetPaths: BundledAssets;
  baseDomain: string;
  managedDomain: ManagedDomainInstallState | undefined;
  publicHttpPort: number;
  publicHttpsPort: number;
  publicIngressIpv4: string;
  publicIngressIpv6: string;
  runtimeSelection: SelfHostedRuntimeSelection;
  stagedAssetPaths: StagedAssetPaths;
}

export interface BuildRenderedInstallEnvironmentInput {
  acmeEmail: string;
  assetPaths: BundledAssets;
  baseDomain: string;
  dockerWorkDirectory: string;
  managedDomain: ManagedDomainInstallState | undefined;
  publicHttpPort: number;
  publicHttpsPort: number;
  publicIngressIpv4: string;
  publicIngressIpv6: string;
  runtimeSelection: SelfHostedRuntimeSelection;
}

export interface RenderInstallEnvironmentInput {
  acmeEmail: string;
  baseDomain: string;
  dockerWorkDirectory: string;
  managedDomain: ManagedDomainInstallState | undefined;
  publicHttpPort: number;
  publicHttpsPort: number;
  publicIngressIpv4: string;
  publicIngressIpv6: string;
  runtimeSelection: SelfHostedRuntimeSelection;
  templateText: string;
}

export interface InstallSecretEnvironment {
  artifactRegistryReadPassword: string;
  artifactRegistryReadUsername: string;
  artifactRegistryWritePassword: string;
  artifactRegistryWriteUsername: string;
  runtimeControlToken: string;
  sessionSecret: string;
  variablesMasterKey: string;
}

export interface InstallSystemApiEnvironment {
  nodeAgentSocketPath: string;
  systemApiSocketPath: string;
  systemToken: string;
}
