import type { OutputFormat } from '../../output/output.types';
import type { SelfHostedInstallServiceOptions } from '../../install.types';

export interface InstallCommandOptions {
  baseDomain?: string | undefined;
  brokerUrl?: string | undefined;
  dev?: boolean | undefined;
  email?: string | undefined;
  imageRegistry?: string | undefined;
  imageSource?: string | undefined;
  internalInstallResult?: boolean | undefined;
  localRuntime?: boolean | undefined;
  managedDomain?: boolean | undefined;
  organization?: string | undefined;
  organizationSlug?: string | undefined;
  output: OutputFormat;
  publicHttpPort?: string | undefined;
  publicHttpsPort?: string | undefined;
  remote?: string | undefined;
  skipSessionPersist?: boolean | undefined;
  version?: string | undefined;
}

export interface ResolvedInstallIdentityPrompts {
  adminEmail: string;
  adminPassword: string;
  organizationName: string;
}

export interface ResolvedInstallPrompts extends ResolvedInstallIdentityPrompts {
  publicHttpPort: number;
  publicHttpsPort: number;
}

export interface ResolvedSelfHostedInstallExecution {
  selfHostedInstallOptions: SelfHostedInstallServiceOptions;
}
