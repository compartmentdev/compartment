import type { OutputFormat } from '../../output/output.types';

export interface InstallCommandOptions {
  adminPassword?: string | undefined;
  apiUrl?: string | undefined;
  baseDomain?: string | undefined;
  brokerUrl?: string | undefined;
  chart?: string | undefined;
  dev?: boolean | undefined;
  email?: string | undefined;
  ingressClass?: string | undefined;
  ingressEndpoint?: string | undefined;
  kubeContext?: string | undefined;
  managedDomain?: boolean | undefined;
  namespace?: string | undefined;
  organization?: string | undefined;
  organizationSlug?: string | undefined;
  output: OutputFormat;
  releaseName?: string | undefined;
  remote?: string | undefined;
  storageClass?: string | undefined;
}

export interface ResolvedInstallIdentityPrompts {
  adminEmail: string;
  adminPassword: string;
  organizationName: string;
}

export interface InstallWizardValues {
  storage: InstallWizardStorageValues;
}

export interface InstallWizardStorageValues {
  storageClass: string;
}
