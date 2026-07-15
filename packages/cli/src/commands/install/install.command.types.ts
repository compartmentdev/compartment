import type { OutputFormat } from '../../output/output.types';

export interface InstallCommandOptions {
  dev?: boolean | undefined;
  email?: string | undefined;
  organization?: string | undefined;
  organizationSlug?: string | undefined;
  output: OutputFormat;
  remote?: string | undefined;
}

export interface ResolvedInstallIdentityPrompts {
  adminEmail: string;
  adminPassword: string;
  organizationName: string;
}
