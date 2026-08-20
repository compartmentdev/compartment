import type { KubeJobResult } from './kube-runtime.types';
import type { TerminalJobResult } from './kube-runtime-job-result.types';

type FinalizeJob = () => Promise<void>;

export class CapturedKubeJobResult implements KubeJobResult {
  public readonly completedAt: Date;
  public readonly exitCode: number | null;
  public readonly jobName: string;
  public readonly logs: string;
  public readonly podName: string | null;
  public readonly preExecutionFailure: 'evidence-unavailable' | 'image-pull' | undefined;
  public readonly status: 'succeeded' | 'failed' | 'timed-out';

  public constructor(
    result: TerminalJobResult,
    private readonly finalizeJob: FinalizeJob,
  ) {
    this.completedAt = result.completedAt;
    this.exitCode = result.exitCode;
    this.jobName = result.jobName;
    this.logs = result.logs;
    this.podName = result.podName;
    this.preExecutionFailure = result.preExecutionFailure;
    this.status = result.status;
  }

  public async finalize(): Promise<void> {
    await this.finalizeJob();
  }
}
