import type { UpdateResponse, UpdateSkipReason } from '@compartment/contracts';
import type { InstallContext, InstallImageSource } from './install.types';
import type { SelfHostedInstallPaths, SelfHostedPathSelection } from './self-hosted-install-paths.types';
import type { SelfHostedInstallState } from './self-hosted-install-state.types';
import type { BundledAssets, StagedAssetPaths } from './runtime-assets.types';
import type {
  RenderedSelfHostedEnvironment,
  SelfHostedRuntimeImageRegistry,
  SelfHostedRuntimeSelection,
} from './self-hosted-env.types';
import type { SelfHostedUpdateDecision } from './update-version.types';

export interface SelfHostedUpdateOptions {
  imageRegistry?: SelfHostedRuntimeImageRegistry | undefined;
  imageSource?: InstallImageSource | undefined;
  version: string;
}

export interface SelfHostedUpdateInput {
  context?: InstallContext | undefined;
  options: SelfHostedUpdateOptions;
}

export type SelfHostedUpdateResult = UpdateResponse;

export type PreparedSelfHostedUpdatePlan = PreparedSelfHostedUpdate | SkippedSelfHostedUpdate;

export interface PreparedSelfHostedUpdate {
  assetPaths: BundledAssets;
  configDir: string;
  currentState: SelfHostedInstallState;
  currentVersion: string;
  dataDir: string;
  imageRegistry: SelfHostedRuntimeImageRegistry;
  imageSource: InstallImageSource;
  installPaths: SelfHostedInstallPaths;
  paths: SelfHostedPathSelection;
  renderedEnvironment: RenderedSelfHostedEnvironment;
  runtimeSelection: SelfHostedRuntimeSelection;
  stagedAssetPaths: StagedAssetPaths;
  targetVersion: string;
  updateAction: 'apply';
}

export interface SkippedSelfHostedUpdate {
  configDir: string;
  currentState: SelfHostedInstallState;
  currentVersion: string;
  dataDir: string;
  imageRegistry: SelfHostedRuntimeImageRegistry;
  imageSource: InstallImageSource;
  skipReason: UpdateSkipReason;
  targetVersion: string;
  updateAction: 'skip';
}

export interface PreparedSelfHostedUpdateEnvironment {
  currentEnvironmentText: string;
  currentState: SelfHostedInstallState;
  imageSource: InstallImageSource;
  imageRegistry: SelfHostedRuntimeImageRegistry;
  installPaths: SelfHostedInstallPaths;
  stagedAssetPaths: StagedAssetPaths;
}

export interface PreparedSelfHostedUpdateDecisionContext {
  currentVersion: string;
  environmentValues: Record<string, string>;
  runtimeSelection: SelfHostedRuntimeSelection;
  updateDecision: SelfHostedUpdateDecision;
}
