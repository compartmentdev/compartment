import type { CliConfig, CliRemoteConfig } from '../store/config.types';
import type { StoredProjectState } from '../store/project-state.types';
import { resolveProjectStateScope } from './project-state-scope.service';
import type { StoredProjectStateReference } from './project-state-scope.service.types';
import {
  RemoteContextResolutionError,
  type RemoteContextInput,
  type ResolvedRemoteContext,
} from './remote-context.types';

export async function resolveRemoteContext(
  config: CliConfig,
  input: RemoteContextInput,
): Promise<ResolvedRemoteContext> {
  const remoteName: string | undefined = await resolveRemoteSelection(config, input);

  if (remoteName === undefined) {
    throw new RemoteContextResolutionError({
      code: 'remote_selection_required',
    });
  }

  return {
    remote: requireRemoteConfig(config, remoteName),
    remoteName,
  };
}

export function findConfiguredRemote(config: CliConfig, remoteName: string): CliRemoteConfig | undefined {
  return config.remotes?.[remoteName];
}

export function listConfiguredRemoteNames(config: CliConfig): string[] {
  return Object.keys(config.remotes ?? {}).sort(compareRemoteNames);
}

async function resolveRemoteSelection(config: CliConfig, input: RemoteContextInput): Promise<string | undefined> {
  if (input.remoteName !== undefined) {
    return input.remoteName;
  }

  return await resolveSavedRemoteSelection(config, input);
}

async function resolveSavedRemoteSelection(config: CliConfig, input: RemoteContextInput): Promise<string | undefined> {
  const stateReference: StoredProjectStateReference | undefined = await findEffectiveStoredProjectState(input);
  const state: StoredProjectState | undefined = stateReference?.state;
  return state?.selectedRemote ?? config.currentRemote;
}

function requireRemoteConfig(config: CliConfig, remoteName: string): CliRemoteConfig {
  const remote: CliRemoteConfig | undefined = config.remotes?.[remoteName];
  if (remote !== undefined) {
    return remote;
  }

  throw new RemoteContextResolutionError({
    code: 'remote_not_configured',
    remoteName,
  });
}

function compareRemoteNames(leftName: string, rightName: string): number {
  return leftName.localeCompare(rightName);
}

async function findEffectiveStoredProjectState(
  input: RemoteContextInput,
): Promise<StoredProjectStateReference | undefined> {
  return input.projectStateScope?.effectiveState ?? (await resolveProjectStateScope(input.cwd)).effectiveState;
}
