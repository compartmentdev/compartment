export interface TerminalJobResult {
  completedAt: Date;
  exitCode: number | null;
  jobName: string;
  logs: string;
  podName: string | null;
  preExecutionFailure?: 'image-pull' | undefined;
  status: 'succeeded' | 'failed' | 'timed-out';
}
