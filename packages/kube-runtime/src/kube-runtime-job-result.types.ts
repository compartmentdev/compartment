export interface TerminalJobResult {
  completedAt: Date;
  exitCode: number | null;
  jobName: string;
  logs: string;
  podName: string | null;
  status: 'succeeded' | 'failed' | 'timed-out';
}
