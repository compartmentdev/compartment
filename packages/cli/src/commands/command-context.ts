import { compartmentManagedCloudControlPlaneUrl } from '@compartment/contracts';
import { hasText } from '@compartment/utils';
import {
  findConfiguredRemote,
  listConfiguredRemoteNames,
  resolveRemoteContext,
} from '../services/remote-context.service';
import {
  RemoteContextResolutionError,
  type RemoteContextInput,
  type ResolvedRemoteContext,
} from '../services/remote-context.types';
import type { ApiContext, AuthenticatedContext } from '../services/context.types';
import type { CliConfig } from '../store/config.types';
import type {
  AuthenticatedContextErrorCode,
  AuthenticatedContextErrorDetails,
  LoginApiUrlResolution,
} from './command-context.types';

const defaultRemoteName: string = 'default';

class AuthenticatedContextError extends Error {
  readonly code: AuthenticatedContextErrorCode;
  readonly remoteName?: string | undefined;

  constructor(code: AuthenticatedContextErrorCode, message: string, details: AuthenticatedContextErrorDetails = {}) {
    super(message);
    this.code = code;
    this.name = 'AuthenticatedContextError';
    this.remoteName = details.remoteName;
  }
}

export async function createAuthenticatedContext(
  config: CliConfig,
  input: RemoteContextInput,
): Promise<AuthenticatedContext> {
  const resolvedRemoteContext: ResolvedRemoteContext = await resolveResolvedRemoteContext(config, input);
  const sessionToken: string = resolveSessionToken(
    resolvedRemoteContext.remoteName,
    resolvedRemoteContext.remote.sessionToken,
  );

  return {
    apiUrl: resolvedRemoteContext.remote.apiUrl,
    currentOrganization: resolvedRemoteContext.remote.currentOrganization,
    ...(resolvedRemoteContext.remote.firstDeployOnboardingSessionId !== undefined
      ? { firstDeployOnboardingSessionId: resolvedRemoteContext.remote.firstDeployOnboardingSessionId }
      : {}),
    remoteName: resolvedRemoteContext.remoteName,
    sessionToken,
  };
}

export async function hasAuthenticatedSession(config: CliConfig, input: RemoteContextInput): Promise<boolean> {
  try {
    const resolvedRemoteContext: ResolvedRemoteContext = await resolveRemoteContext(config, input);
    return hasText(resolvedRemoteContext.remote.sessionToken);
  } catch {
    return false;
  }
}

export function resolveLoginRemoteName(config: CliConfig, explicitRemoteName?: string): string {
  return explicitRemoteName ?? config.currentRemote ?? defaultRemoteName;
}

export function resolveLoginApiUrl(
  config: CliConfig,
  remoteName: string,
  explicitApiUrl?: string,
): LoginApiUrlResolution {
  if (hasText(explicitApiUrl)) {
    return {
      apiUrl: explicitApiUrl,
      source: 'explicit',
    };
  }

  const storedRemoteApiUrl: string | undefined = findConfiguredRemote(config, remoteName)?.apiUrl;
  if (hasText(storedRemoteApiUrl)) {
    return {
      apiUrl: storedRemoteApiUrl,
      source: 'stored-remote',
    };
  }

  return {
    apiUrl: compartmentManagedCloudControlPlaneUrl,
    source: 'managed-cloud',
  };
}

export function createApiContext(apiUrl: string): ApiContext {
  return { apiUrl };
}

async function resolveResolvedRemoteContext(
  config: CliConfig,
  input: RemoteContextInput,
): Promise<ResolvedRemoteContext> {
  try {
    return await resolveRemoteContext(config, input);
  } catch (error) {
    throw toAuthenticatedContextError(
      config,
      error instanceof Error ? error : new Error('Unknown authenticated context error.'),
    );
  }
}

export function toAuthenticatedContextError(config: CliConfig, error: Error): Error {
  if (!(error instanceof RemoteContextResolutionError)) {
    return error;
  }
  if (error.code === 'remote_selection_required' && listConfiguredRemoteNames(config).length === 0) {
    return createNoConfiguredLoginError();
  }

  return mapRemoteContextResolutionError(error);
}

function resolveSessionToken(remoteName: string, sessionToken: string | undefined): string {
  if (hasText(sessionToken)) {
    return sessionToken;
  }

  throw new AuthenticatedContextError(
    'remote_logged_out',
    `You are not logged in for remote "${remoteName}". Run \`compartment login --remote ${remoteName}\` first.`,
    {
      remoteName,
    },
  );
}

function createNoConfiguredLoginError(): AuthenticatedContextError {
  return new AuthenticatedContextError(
    'no_configured_login',
    'No Compartment login is configured. Run `compartment login --api-url <url>` first.',
  );
}

function mapRemoteContextResolutionError(error: RemoteContextResolutionError): AuthenticatedContextError {
  switch (error.code) {
    case 'remote_selection_required':
      return createRemoteSelectionRequiredError();
    case 'remote_not_configured':
      return createRemoteNotConfiguredError(error);
  }
}

function createRemoteSelectionRequiredError(): AuthenticatedContextError {
  return new AuthenticatedContextError(
    'remote_selection_required',
    'No remote is selected. Pass --remote <name> or run `compartment remote use <name>` first.',
  );
}

function createRemoteNotConfiguredError(error: RemoteContextResolutionError): AuthenticatedContextError {
  const remoteName: string = error.remoteName!;
  return new AuthenticatedContextError(
    'remote_not_configured',
    `Remote "${remoteName}" is not configured. Run \`compartment login --remote ${remoteName} --api-url <url>\` first.`,
    {
      remoteName,
    },
  );
}
