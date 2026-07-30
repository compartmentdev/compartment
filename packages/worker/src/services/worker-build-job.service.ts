import type { DockerBuildImageResult, DockerProgressLine } from '@compartment/docker';
import type {
  KubeJobEmptyDirVolume,
  KubeJobResult,
  KubeJobSidecar,
  KubeJobSpec,
  KubeRuntime,
} from '@compartment/kube-runtime';
import type { WorkerBuildSandboxConfig } from '../config';
import type { RunWorkerBuildJobInput, WorkerBuildJobInput, WorkerBuildJobLogRecord } from './worker-build-job.types';

const buildKitAddress: string = 'tcp://127.0.0.1:1234';
const buildJobInputEnvironmentName: string = 'COMPARTMENT_BUILD_JOB_INPUT';
const buildJobTokenEnvironmentName: string = 'COMPARTMENT_BUILD_JOB_INTERNAL_TOKEN';

export async function runWorkerBuildJob(
  runtime: Pick<KubeRuntime, 'runJob'>,
  config: WorkerBuildSandboxConfig,
  input: RunWorkerBuildJobInput,
): Promise<DockerBuildImageResult> {
  const capture: KubeJobResult = await runtime.runJob(buildKubeJobSpec(config, input));
  try {
    await publishCapturedProgress(capture.logs, input.onProgressLine);
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
    { name: 'buildkit-data' },
    { name: 'buildkit-rootless-tmp' },
    { name: 'buildkit-run' },
    { containerMountPath: '/tmp', name: 'tmp' },
  ];
}

function buildKitSidecar(config: WorkerBuildSandboxConfig): KubeJobSidecar {
  return {
    args: [
      '--addr',
      buildKitAddress,
      '--oci-worker-no-process-sandbox',
      '--oci-worker-snapshotter=native',
      '--oci-worker-gc-keepstorage',
      String(config.gcKeepStorageMb),
    ],
    env: { HOME: '/home/user', XDG_RUNTIME_DIR: '/run/user/1000' },
    image: config.buildKitImage,
    name: 'buildkit',
    resources: config.buildKitResources,
    securityProfile: 'rootless-buildkit',
    volumeMounts: [
      { mountPath: '/home/user/.local/share/buildkit', name: 'buildkit-data' },
      { mountPath: '/home/user/.local/tmp', name: 'buildkit-rootless-tmp' },
      { mountPath: '/run/user/1000', name: 'buildkit-run' },
      { mountPath: '/tmp', name: 'tmp' },
    ],
  };
}

async function publishCapturedProgress(
  logs: string,
  reporter: ((line: DockerProgressLine) => void | Promise<void>) | undefined,
): Promise<void> {
  if (reporter === undefined) {
    return;
  }
  for (const record of readBuildLogRecords(logs)) {
    if (record.type === 'progress') {
      await reporter(record.progress);
    }
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
  const record: WorkerBuildJobLogRecord | undefined = readBuildLogRecords(logs).findLast(
    (candidate: WorkerBuildJobLogRecord): boolean => candidate.type === 'failure',
  );
  return record?.type === 'failure' ? record.message : 'runner exited without a structured failure';
}

function readBuildLogRecords(logs: string): WorkerBuildJobLogRecord[] {
  return logs.split('\n').flatMap((line: string): WorkerBuildJobLogRecord[] => {
    try {
      const record: WorkerBuildJobLogRecord = JSON.parse(line) as WorkerBuildJobLogRecord;
      return [record];
    } catch {
      return [];
    }
  });
}
