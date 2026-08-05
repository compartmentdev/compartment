import type { DockerBuildImageResult, DockerProgressLine } from '@compartment/docker';
import {
  KubeJobLogAttachmentError,
  type KubeJobEmptyDirVolume,
  type KubeJobResult,
  type KubeRunJobOptions,
  type KubeJobSidecar,
  type KubeJobSpec,
  type KubeRuntime,
} from '@compartment/kube-runtime';
import type { WorkerBuildSandboxConfig } from '../config';
import type { RunWorkerBuildJobInput, WorkerBuildJobInput, WorkerBuildJobLogRecord } from './worker-build-job.types';
import { readBuildLogRecord, readBuildLogRecords } from './worker-build-log-record';

const buildKitAddress: string = 'tcp://127.0.0.1:1234';
const buildJobInputEnvironmentName: string = 'COMPARTMENT_BUILD_JOB_INPUT';
const buildJobTokenEnvironmentName: string = 'COMPARTMENT_BUILD_JOB_INTERNAL_TOKEN';

export async function runWorkerBuildJob(
  runtime: Pick<KubeRuntime, 'runJob'>,
  config: WorkerBuildSandboxConfig,
  input: RunWorkerBuildJobInput,
): Promise<DockerBuildImageResult> {
  const progress: BuildProgressStream | undefined =
    input.onProgressLine === undefined ? undefined : new BuildProgressStream(input.onProgressLine);
  const options: KubeRunJobOptions | undefined =
    progress === undefined ? undefined : new WorkerBuildJobRunOptions(progress);
  const capture: KubeJobResult = await runtime.runJob(buildKubeJobSpec(config, input), undefined, options);
  try {
    await progress?.drain();
    await progress?.publishCapturedFallback(capture.logs);
    if (capture.status !== 'succeeded') {
      throw new Error(
        `Sandboxed build Job ${capture.jobName} ${capture.status}: ${readCapturedBuildFailure(capture.logs)}`,
      );
    }
    return readCapturedBuildResult(capture.logs);
  } finally {
    await capture.finalize();
  }
}

class WorkerBuildJobRunOptions implements KubeRunJobOptions {
  constructor(private readonly progress: BuildProgressStream) {}

  readonly onLogChunk: (chunk: string) => Promise<void> = async (chunk: string): Promise<void> =>
    await this.progress.write(chunk);

  readonly onLogError: (error: Error) => void = (error: Error): void => {
    if (!(error instanceof KubeJobLogAttachmentError)) {
      this.progress.fail(error);
    }
  };
}

export function readWorkerBuildJobInputEnvironment(env: NodeJS.ProcessEnv): {
  input: WorkerBuildJobInput;
  internalToken: string;
} {
  const serializedInput: string | undefined = env[buildJobInputEnvironmentName];
  const internalToken: string | undefined = env[buildJobTokenEnvironmentName];
  if (serializedInput === undefined || serializedInput === '') {
    throw new Error(`${buildJobInputEnvironmentName} is required.`);
  }
  if (internalToken === undefined || internalToken === '') {
    throw new Error(`${buildJobTokenEnvironmentName} is required.`);
  }
  return {
    input: JSON.parse(serializedInput) as WorkerBuildJobInput,
    internalToken,
  };
}

export function writeWorkerBuildJobLog(record: WorkerBuildJobLogRecord): void {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

function buildKubeJobSpec(config: WorkerBuildSandboxConfig, input: RunWorkerBuildJobInput): KubeJobSpec {
  return {
    cleanupPolicy: 'delete',
    command: ['node', 'dist/build-job.js'],
    emptyDirVolumes: buildJobVolumes(),
    env: buildJobEnvironment(input),
    id: input.id,
    image: config.runnerImage,
    jobClass: 'build',
    labels: { 'compartment.dev/job-class': 'build' },
    namespace: config.namespace,
    priorityClassName: 'compartment-platform',
    resources: config.runnerResources,
    scheduling: config.scheduling,
    securityProfile: 'restricted',
    sidecars: [buildKitSidecar(config)],
    timeoutMs: config.timeoutMs,
  };
}

function buildJobEnvironment(input: RunWorkerBuildJobInput): Record<string, string> {
  return {
    [buildJobInputEnvironmentName]: JSON.stringify(input.build),
    [buildJobTokenEnvironmentName]: input.internalToken,
    BUILDKIT_ADDR: buildKitAddress,
    TMPDIR: '/tmp',
  };
}

function buildJobVolumes(): KubeJobEmptyDirVolume[] {
  return [
    { gvisorTmpfs: true, name: 'buildkit-data', sizeLimit: '3Gi' },
    { gvisorTmpfs: true, name: 'buildkit-run', sizeLimit: '128Mi' },
    { gvisorTmpfs: true, name: 'buildkit-tmp', sizeLimit: '1Gi' },
    { containerMountPath: '/tmp', gvisorTmpfs: true, name: 'tmp', sizeLimit: '1Gi' },
  ];
}

function buildKitSidecar(config: WorkerBuildSandboxConfig): KubeJobSidecar {
  return {
    args: [
      '--addr',
      buildKitAddress,
      '--oci-worker=true',
      '--oci-worker-binary=/usr/local/bin/buildkit-runc-gvisor',
      '--oci-worker-gc-keepstorage',
      String(config.gcKeepStorageMb),
    ],
    command: ['/usr/local/bin/buildkitd'],
    env: { HOME: '/tmp', TMPDIR: '/buildkit-tmp' },
    image: config.runnerImage,
    name: 'buildkit',
    resources: config.buildKitResources,
    volumeMounts: [
      { mountPath: '/var/lib/buildkit', name: 'buildkit-data' },
      { mountPath: '/run', name: 'buildkit-run' },
      { mountPath: '/buildkit-tmp', name: 'buildkit-tmp' },
    ],
  };
}

class BuildProgressStream {
  private error: Error | null = null;
  private publishedProgressCount: number = 0;
  private unprocessed: string = '';

  public constructor(private readonly reporter: (line: DockerProgressLine) => void | Promise<void>) {}

  public async write(chunk: string): Promise<void> {
    this.unprocessed += chunk;
    await this.publishCompleteLines();
  }

  public fail(error: Error): void {
    this.error = error;
  }

  public async drain(): Promise<void> {
    if (this.unprocessed !== '') {
      await this.publishLine(this.unprocessed);
      this.unprocessed = '';
    }
    if (this.error !== null) {
      throw this.error;
    }
  }

  public async publishCapturedFallback(logs: string): Promise<void> {
    if (this.publishedProgressCount !== 0) {
      return;
    }
    for (const record of readBuildLogRecords(logs)) {
      if (record.type === 'progress') {
        await this.publishProgress(record.progress);
      }
    }
  }

  private async publishCompleteLines(): Promise<void> {
    const lines: string[] = this.unprocessed.split('\n');
    this.unprocessed = lines.pop() ?? '';
    for (const line of lines) {
      await this.publishLine(line);
    }
  }

  private async publishLine(line: string): Promise<void> {
    const record: WorkerBuildJobLogRecord | undefined = readBuildLogRecord(line);
    if (record?.type === 'progress') {
      await this.publishProgress(record.progress);
    }
  }

  private async publishProgress(progress: DockerProgressLine): Promise<void> {
    await this.reporter(progress);
    this.publishedProgressCount += 1;
  }
}

function readCapturedBuildResult(logs: string): DockerBuildImageResult {
  const record: WorkerBuildJobLogRecord | undefined = readBuildLogRecords(logs).findLast(
    (candidate: WorkerBuildJobLogRecord): boolean => candidate.type === 'result',
  );
  if (record?.type !== 'result') {
    throw new Error('Sandboxed build Job did not emit a result.');
  }
  return record.result;
}

function readCapturedBuildFailure(logs: string): string {
  const records: WorkerBuildJobLogRecord[] = readBuildLogRecords(logs);
  const record: WorkerBuildJobLogRecord | undefined = records.findLast(
    (candidate: WorkerBuildJobLogRecord): boolean => candidate.type === 'failure',
  );
  const message: string = record?.type === 'failure' ? record.message : 'runner exited without a structured failure';
  const terminalProgress: string = records
    .filter((candidate: WorkerBuildJobLogRecord): boolean => candidate.type === 'progress')
    .slice(-20)
    .map((candidate: WorkerBuildJobLogRecord): string =>
      candidate.type === 'progress' ? `[${candidate.progress.stream}] ${candidate.progress.message}` : '',
    )
    .join('\n');
  return terminalProgress === '' ? message : `${message}\nBuildKit terminal output:\n${terminalProgress}`;
}
