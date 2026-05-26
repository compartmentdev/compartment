import { resolve } from 'node:path';
import { buildStagedAssetPaths } from './runtime-assets';
import type { SelfHostedInstallPaths, SelfHostedPathSelection } from './self-hosted-install-paths.types';

const defaultSelfHostedConfigDir: string = '/etc/compartment';
const defaultSelfHostedDataDir: string = '/var/lib/compartment';
const selfHostedDataDirectoryName: string = 'self-hosted';

export function buildSelfHostedPathSelection(): SelfHostedPathSelection {
  return {
    configDir: resolve(defaultSelfHostedConfigDir),
    dataDir: resolve(defaultSelfHostedDataDir),
  };
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
