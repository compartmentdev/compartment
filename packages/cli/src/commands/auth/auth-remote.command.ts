import { hasText } from '@compartment/utils';
import type { CliIo } from '../../app.types';
import { promptRemoteName } from '../../prompts/prompt';
import { findConfiguredRemote, listConfiguredRemoteNames } from '../../services/remote-context.service';
import type { CliConfig, CliRemoteConfig } from '../../store/config.types';
import type { OutputFormat } from '../../output/output.types';
import { resolveLoginApiUrl, resolveLoginRemoteName } from '../command-context';
import type { LoginApiUrlResolution } from '../command-context.types';

export interface ResolvedLoginRemote {
  apiUrl: string;
  remoteName: string;
}

export async function resolveLoginRemote(
  io: CliIo,
  config: CliConfig,
  output: OutputFormat,
  explicitRemoteName: string | undefined,
  explicitApiUrl: string | undefined,
): Promise<ResolvedLoginRemote> {
  const remoteName: string = resolveLoginRemoteName(config, explicitRemoteName);
  const existingRemote: CliRemoteConfig | undefined = findConfiguredRemote(config, remoteName);
  if (
    explicitRemoteName === undefined &&
    hasText(explicitApiUrl) &&
    existingRemote !== undefined &&
    existingRemote.apiUrl !== explicitApiUrl
  ) {
    return await resolveConflictingLoginRemote(io, config, output, remoteName, existingRemote.apiUrl, explicitApiUrl);
  }

  const apiUrlResolution: LoginApiUrlResolution = resolveLoginApiUrl(config, remoteName, explicitApiUrl);
  if (apiUrlResolution.source === 'managed-cloud') {
    io.stderr(`Using Compartment Cloud at ${new URL(apiUrlResolution.apiUrl).host}.\n`);
  }

  return {
    apiUrl: apiUrlResolution.apiUrl,
    remoteName,
  };
}

async function resolveConflictingLoginRemote(
  io: CliIo,
  config: CliConfig,
  output: OutputFormat,
  remoteName: string,
  existingApiUrl: string,
  apiUrl: string,
): Promise<ResolvedLoginRemote> {
  if (output === 'json') {
    throw new Error(buildRemoteUrlMismatchMessage(remoteName, existingApiUrl));
  }

  return {
    apiUrl,
    remoteName: await promptUniqueRemoteName(io, config, buildSuggestedRemoteName(config, remoteName)),
  };
}

function buildRemoteUrlMismatchMessage(remoteName: string, existingApiUrl: string): string {
  return `Current CLI remote "${remoteName}" points to ${existingApiUrl}. Pass --remote <name> for the new URL.`;
}

async function promptUniqueRemoteName(io: CliIo, config: CliConfig, defaultName: string): Promise<string> {
  for (;;) {
    const remoteName: string = await promptRemoteName(io, defaultName);
    if (findConfiguredRemote(config, remoteName) === undefined) {
      return remoteName;
    }

    io.stderr(`Remote "${remoteName}" already exists.\n`);
  }
}

function buildSuggestedRemoteName(config: CliConfig, remoteName: string): string {
  const configuredRemoteNames: Set<string> = new Set<string>(listConfiguredRemoteNames(config));
  if (!configuredRemoteNames.has(remoteName)) {
    return remoteName;
  }

  for (let suffix: number = 2; ; suffix += 1) {
    const candidateName: string = `${remoteName}-${suffix}`;
    if (!configuredRemoteNames.has(candidateName)) {
      return candidateName;
    }
  }
}
