export interface CliOrganizationConfig {
  id: string;
  name: string;
  slug: string;
}

export interface CliRemoteConfig {
  apiUrl: string;
  currentOrganization?: CliOrganizationConfig | undefined;
  firstDeployOnboardingSessionId?: string | undefined;
  principalEmail?: string | undefined;
  sessionToken?: string | undefined;
}

export interface CliConfig {
  currentRemote?: string | undefined;
  remotes?: Record<string, CliRemoteConfig> | undefined;
}
