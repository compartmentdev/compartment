import type {
  CliRemoteListResponse,
  CliRemoteRemoveResponse,
  CliRemoteResponse,
  CliRemoteSummary,
} from '@compartment/contracts';
import { buildCurrentRemoteConfig, buildRemoteRemovedConfig } from '../store/config.mutations';
import { readProjectStateFilePath, writeStoredProjectState } from '../store/project-state.store';
import type { CliConfig, CliRemoteConfig } from '../store/config.types';
import { resolveProjectStateWriteRoot } from './project-state-scope.service';
import { findConfiguredRemote, listConfiguredRemoteNames } from './remote-context.service';
import type { RemoveRemoteResult, UseRemoteResult } from './remotes.service.types';

export function listRemotes(config: CliConfig): CliRemoteListResponse {
  return {
    currentRemote: config.currentRemote ?? null,
    remotes: listConfiguredRemoteNames(config).map(
      (remoteName: string): CliRemoteSummary =>
        toCliRemoteSummary(remoteName, findConfiguredRemote(config, remoteName)!),
    ),
  };
}

export async function useRemote(config: CliConfig, cwd: string, remoteName: string): Promise<UseRemoteResult> {
  const remote: CliRemoteConfig = requireConfiguredRemote(config, remoteName);
  const projectStateRoot: string | undefined = await resolveProjectStateWriteRoot(cwd);
  if (projectStateRoot !== undefined) {
    await writeStoredProjectState(projectStateRoot, {
      selectedRemote: remoteName,
    });
  }

  return {
    config: buildCurrentRemoteConfig(config, remoteName),
    response: {
      remote: toCliRemoteSummary(remoteName, remote),
    },
    ...(projectStateRoot !== undefined ? { stateFilePath: readProjectStateFilePath(projectStateRoot) } : {}),
    wroteProjectState: projectStateRoot !== undefined,
  };
}

export function removeRemote(config: CliConfig, remoteName: string): RemoveRemoteResult {
  requireConfiguredRemote(config, remoteName);

  return {
    config: buildRemoteRemovedConfig(config, remoteName),
    response: {
      remoteName,
    },
  };
}

export function createRemoteListMessage(response: CliRemoteListResponse): string {
  if (response.remotes.length === 0) {
    return 'No remotes configured.';
  }

  return response.remotes
    .map(
      (remote: CliRemoteSummary): string =>
        `${response.currentRemote === remote.name ? '*' : ' '} ${remote.name}\t${remote.apiUrl}`,
    )
    .join('\n');
}

export function createRemoteUseMessage(
  response: CliRemoteResponse,
  stateFilePath: string | undefined,
  wroteProjectState: boolean,
): string {
  if (wroteProjectState && stateFilePath !== undefined) {
    return `Using remote ${response.remote.name}. Updated ${stateFilePath}.`;
  }

  return `Using remote ${response.remote.name}.`;
}

export function createRemoteRemoveMessage(response: CliRemoteRemoveResponse): string {
  return `Removed remote ${response.remoteName}.`;
}

function requireConfiguredRemote(config: CliConfig, remoteName: string): CliRemoteConfig {
  const remote: CliRemoteConfig | undefined = findConfiguredRemote(config, remoteName);
  if (remote !== undefined) {
    return remote;
  }

  throw new Error(`Remote "${remoteName}" is not configured.`);
}

function toCliRemoteSummary(remoteName: string, remote: CliRemoteConfig): CliRemoteSummary {
  return {
    apiUrl: remote.apiUrl,
    currentOrganization:
      remote.currentOrganization !== undefined
        ? {
            id: remote.currentOrganization.id,
            name: remote.currentOrganization.name,
            slug: remote.currentOrganization.slug,
          }
        : null,
    name: remoteName,
  };
}
