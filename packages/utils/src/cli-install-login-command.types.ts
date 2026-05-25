export interface CliInstallLoginCommandInput {
  apiUrl: string;
  email: string;
  onboardingSessionId?: string | undefined;
  organizationSlug: string;
}
