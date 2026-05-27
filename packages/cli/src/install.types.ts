import type { InstallResponse, SelfHostedImageSource } from '@compartment/contracts';
import type { ManagedDomainInstallState } from './managed-domain.types';
import type { SelfHostedPathSelection } from './self-hosted-install-paths.types';
import type {
  SelfHostedRuntimeImageRegistry,
  SelfHostedRuntimeSelection,
  RenderedSelfHostedEnvironment,
} from './self-hosted-env.types';
import type { BundledAssets, StagedAssetPaths } from './runtime-assets.types';

export interface InstallProgressReportOptions {
  renderMode?: 'line' | 'spinner' | undefined;
}

export type InstallProgressReporter = (message: string, options?: InstallProgressReportOptions) => void;
export type ConfirmInstallWhenMissing = () => Promise<boolean>;

export interface InstallContext {
  allowInteractiveSudo?: boolean | undefined;
  confirmInstallWhenMissing?: ConfirmInstallWhenMissing | undefined;
  packageDirectory?: string | undefined;
  reportProgress?: InstallProgressReporter | undefined;
}

export type InstallImageSource = SelfHostedImageSource;

export interface SelfHostedInstallPreflightOptions {
  imageRegistry: SelfHostedRuntimeImageRegistry;
  imageSource: InstallImageSource;
  publicHttpPort: number;
  publicHttpsPort: number;
  version: string;
}

export interface SelfHostedInstallServiceOptions {
  adminEmail: string;
  adminPassword: string;
  baseDomain: string;
  imageRegistry: SelfHostedRuntimeImageRegistry;
  imageSource: InstallImageSource;
  installationId: string;
  managedDomain?: ManagedDomainInstallState | undefined;
  organizationName: string;
  organizationSlug?: string | undefined;
  publicHttpPort: number;
  publicHttpsPort: number;
  publicIngressIpv4: string;
  publicIngressIpv6: string;
  version: string;
}

export interface SelfHostedInstallResult extends InstallResponse {
  apiUrl: string;
  configDir: string;
  dataDir: string;
}

export interface SelfHostedInstallInput {
  context?: InstallContext | undefined;
  options: SelfHostedInstallServiceOptions;
}

export interface SelfHostedInstallPreflightInput {
  context?: InstallContext | undefined;
  options: SelfHostedInstallPreflightOptions;
}

export interface PreparedInstallEnvironment {
  assetPaths: BundledAssets;
  baseDomain: string;
  paths: SelfHostedPathSelection;
  renderedEnvironment: RenderedSelfHostedEnvironment;
  runtimeSelection: SelfHostedRuntimeSelection;
  stagedAssetPaths: StagedAssetPaths;
}

export interface PreparedInstallEnvironmentOptions {
  baseDomain: string;
  runtimeSelection: SelfHostedRuntimeSelection;
}
