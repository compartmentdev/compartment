import type { CliConfig, CliOrganizationConfig, CliRemoteConfig } from './config.types';

export function buildLoggedInConfig(
  config: CliConfig,
  remoteName: string,
  apiUrl: string,
  principalEmail: string,
  sessionToken: string,
  currentOrganization?: CliOrganizationConfig,
  firstDeployOnboardingSessionId?: string,
): CliConfig {
  return {
    currentRemote: remoteName,
    remotes: {
      ...(config.remotes ?? {}),
      [remoteName]: buildRemoteConfig(
        apiUrl,
        principalEmail,
        sessionToken,
        currentOrganization,
        firstDeployOnboardingSessionId,
      ),
    },
  };
}

export function buildOrganizationSelectionConfig(
  config: CliConfig,
  remoteName: string,
  currentOrganization: CliOrganizationConfig,
): CliConfig {
  const remoteConfig: CliRemoteConfig = requireRemoteConfig(config, remoteName);

  return {
    ...config,
    currentRemote: remoteName,
    remotes: {
      ...(config.remotes ?? {}),
      [remoteName]: {
        ...remoteConfig,
        currentOrganization,
      },
    },
  };
}

export function buildCurrentRemoteConfig(config: CliConfig, remoteName: string): CliConfig {
  requireRemoteConfig(config, remoteName);

  return {
    ...config,
    currentRemote: remoteName,
  };
}

export function buildLoggedOutConfig(config: CliConfig, remoteName: string): CliConfig {
  const remoteConfig: CliRemoteConfig = requireRemoteConfig(config, remoteName);

  return {
    ...config,
    remotes: {
      ...(config.remotes ?? {}),
      [remoteName]: {
        apiUrl: remoteConfig.apiUrl,
      },
    },
  };
}

export function buildFirstDeployOnboardingSessionClearedConfig(
  config: CliConfig,
  remoteName: string,
  expectedSessionId: string,
): CliConfig {
  const remoteConfig: CliRemoteConfig = requireRemoteConfig(config, remoteName);
  if (remoteConfig.firstDeployOnboardingSessionId !== expectedSessionId) {
    return config;
  }

  const nextRemoteConfig: CliRemoteConfig = { ...remoteConfig };
  delete nextRemoteConfig.firstDeployOnboardingSessionId;

  return {
    ...config,
    remotes: {
      ...(config.remotes ?? {}),
      [remoteName]: nextRemoteConfig,
    },
  };
}

export function buildRemoteRemovedConfig(config: CliConfig, remoteName: string): CliConfig {
  requireRemoteConfig(config, remoteName);
  const nextRemotes: Record<string, CliRemoteConfig> = { ...(config.remotes ?? {}) };
  delete nextRemotes[remoteName];
  const remainingRemoteNames: string[] = Object.keys(nextRemotes);
  const nextCurrentRemote: string | undefined = config.currentRemote === remoteName ? undefined : config.currentRemote;

  return {
    ...(nextCurrentRemote !== undefined ? { currentRemote: nextCurrentRemote } : {}),
    ...(remainingRemoteNames.length > 0 ? { remotes: nextRemotes } : {}),
  };
}

function buildRemoteConfig(
  apiUrl: string,
  principalEmail: string,
  sessionToken: string,
  currentOrganization?: CliOrganizationConfig,
  firstDeployOnboardingSessionId?: string,
): CliRemoteConfig {
  return {
    apiUrl,
    ...(currentOrganization !== undefined ? { currentOrganization } : {}),
    ...(firstDeployOnboardingSessionId !== undefined ? { firstDeployOnboardingSessionId } : {}),
    principalEmail,
    sessionToken,
  };
}

function requireRemoteConfig(config: CliConfig, remoteName: string): CliRemoteConfig {
  const remoteConfig: CliRemoteConfig | undefined = config.remotes?.[remoteName];
  if (remoteConfig !== undefined) {
    return remoteConfig;
  }

  throw new Error(`Remote "${remoteName}" is not configured.`);
}
