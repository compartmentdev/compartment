import type { OutputFormat } from '../../output/output.types';

export interface InstallCommandOptions {
  apiUrl?: string | undefined;
  baseDomain?: string | undefined;
  chart?: string | undefined;
  dev?: boolean | undefined;
  email?: string | undefined;
  kubeContext?: string | undefined;
  namespace?: string | undefined;
  organization?: string | undefined;
  organizationSlug?: string | undefined;
  output: OutputFormat;
  releaseName?: string | undefined;
  remote?: string | undefined;
  values?: string | undefined;
}

export interface ResolvedInstallIdentityPrompts {
  adminEmail: string;
  adminPassword: string;
  organizationName: string;
}

export interface ResolvedKubernetesInstallCommandOptions {
  apiUrl: string;
  baseDomain: string;
  chartPath?: string | undefined;
  kubeContext?: string | undefined;
  namespace: string;
  releaseName: string;
  valuesPath: string;
}
