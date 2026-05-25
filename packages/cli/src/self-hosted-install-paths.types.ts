import type { StagedAssetPaths } from './runtime-assets.types';

export interface SelfHostedPathSelection {
  configDir: string;
  dataDir: string;
}

export interface SelfHostedInstallPaths {
  backupRootDirectory: string;
  configDir: string;
  dataDir: string;
  statePath: string;
  stagedAssetPaths: StagedAssetPaths;
}
