import type { CommandProgress } from '../command.progress.types';

export type { DeploymentStatusReporter } from '../../services/deployments.types';

export interface DeploymentFormatOptions {
  now?: number | undefined;
  showSelectionNotice?: boolean | undefined;
  verbose?: boolean | undefined;
}

export interface DeploymentProgressReporterOptions {
  now?: (() => number) | undefined;
  progress: CommandProgress;
}

export interface DeploymentProgressState {
  lastSignature: string | null;
}

export interface DeploymentSummaryParts {
  durationLabel: string | null;
}
