export interface InstallInput {
  adminEmail: string;
  adminPassword: string;
  baseDomain: string;
  organizationName: string;
  organizationSlug?: string | undefined;
}
