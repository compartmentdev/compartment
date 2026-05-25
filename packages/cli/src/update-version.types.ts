import type { UpdateSkipReason } from '@compartment/contracts';
import type { InstallImageSource } from './install.types';

export interface DecideSelfHostedUpdateActionInput {
  currentImageSource: InstallImageSource;
  currentVersion: string;
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
