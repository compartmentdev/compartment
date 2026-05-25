import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildLegacyStagedAssetPaths, buildStagedAssetPaths } from './runtime-assets';
import type { SelfHostedInstallPaths, SelfHostedPathSelection } from './self-hosted-install-paths.types';

const defaultSelfHostedConfigDir: string = '/etc/compartment';
const defaultSelfHostedDataDir: string = '/var/lib/compartment';
const selfHostedDataDirectoryName: string = 'self-hosted';
const legacySelfHostedDataDirectoryName: string = ['on', 'prem'].join('');

export function buildSelfHostedPathSelection(): SelfHostedPathSelection {
  return {
    configDir: resolve(defaultSelfHostedConfigDir),
    dataDir: resolve(defaultSelfHostedDataDir),
  };
}

export function resolveExistingSelfHostedInstallPaths(paths: SelfHostedPathSelection): SelfHostedInstallPaths {
  const candidates: readonly SelfHostedInstallPaths[] = buildSelfHostedInstallPathCandidates(paths);
  return (
    candidates.find(hasCompleteInstallPathMarkers) ??
    candidates.find(hasAnyInstallPathMarker) ??
    buildSelfHostedInstallPaths(paths)
  );
}

function buildSelfHostedInstallPathCandidates(paths: SelfHostedPathSelection): readonly SelfHostedInstallPaths[] {
  return [buildSelfHostedInstallPaths(paths), buildLegacySelfHostedInstallPaths(paths)];
}

export function buildSelfHostedInstallPaths(paths: SelfHostedPathSelection): SelfHostedInstallPaths {
  return {
    backupRootDirectory: resolve(paths.dataDir, selfHostedDataDirectoryName, 'backups'),
    configDir: paths.configDir,
    dataDir: paths.dataDir,
    statePath: resolve(paths.dataDir, selfHostedDataDirectoryName, 'install-state.json'),
    stagedAssetPaths: buildStagedAssetPaths(paths.configDir, paths.dataDir),
  };
}

function buildLegacySelfHostedInstallPaths(paths: SelfHostedPathSelection): SelfHostedInstallPaths {
  return {
    backupRootDirectory: resolve(paths.dataDir, legacySelfHostedDataDirectoryName, 'backups'),
    configDir: paths.configDir,
    dataDir: paths.dataDir,
    statePath: resolve(paths.dataDir, legacySelfHostedDataDirectoryName, 'install-state.json'),
    stagedAssetPaths: buildLegacyStagedAssetPaths(paths.configDir, paths.dataDir),
  };
}

function hasCompleteInstallPathMarkers(paths: SelfHostedInstallPaths): boolean {
  return existsSync(paths.stagedAssetPaths.envPath) && existsSync(paths.statePath);
}

function hasAnyInstallPathMarker(paths: SelfHostedInstallPaths): boolean {
  return existsSync(paths.stagedAssetPaths.envPath) || existsSync(paths.statePath);
}
