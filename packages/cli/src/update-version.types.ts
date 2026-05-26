import type { UpdateSkipReason } from '@compartment/contracts';
import type { InstallImageSource } from './install.types';
import type { SelfHostedRuntimeImageRegistry } from './self-hosted-env.types';

export interface DecideSelfHostedUpdateActionInput {
  currentImageRegistry: SelfHostedRuntimeImageRegistry;
  currentImageRegistryRecorded: boolean;
  currentImageSource: InstallImageSource;
  currentVersion: string;
  targetImageRegistry: SelfHostedRuntimeImageRegistry;
  targetImageRegistryRequested: boolean;
  targetImageSource: InstallImageSource;
  targetVersion: string;
}

export type SelfHostedUpdateDecision = ApplySelfHostedUpdateDecision | SkipSelfHostedUpdateDecision;

export interface ApplySelfHostedUpdateDecision {
  action: 'apply';
}

export interface ParsedSelfHostedReleaseVersion {
  major: number;
  minor: number;
  patch: number;
}

export interface SkipSelfHostedUpdateDecision {
  action: 'skip';
  reason: UpdateSkipReason;
}
