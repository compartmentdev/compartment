import type { CommandProgress } from '../command.progress.types';

export type { DeploymentStatusReporter } from '../../services/deployments.types';

export interface DeploymentFormatOptions {
  now?: number | undefined;
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

export interface LogsMessageParts {
  details: string;
  lines: string;
}
