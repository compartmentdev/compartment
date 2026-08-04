import type { DockerBuildImageResult, DockerProgressLine } from '@compartment/docker';
import { workerBuildJobInputSchema, workerBuildJobLogRecordSchema } from '@compartment/contracts';
import type { JsonValue } from '@compartment/utils';
import type {
  KubeJobEmptyDirVolume,
  KubeJobInitializer,
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
  buildJobToken: string;
} {
  const serializedInput: string | undefined = env[buildJobInputEnvironmentName];
  const buildJobToken: string | undefined = env[buildJobTokenEnvironmentName];
  if (serializedInput === undefined || serializedInput === '') {
    throw new Error(`${buildJobInputEnvironmentName} is required.`);
  }
  if (buildJobToken === undefined || buildJobToken === '') {
    throw new Error(`${buildJobTokenEnvironmentName} is required.`);
  }
  return { input: workerBuildJobInputSchema.parse(JSON.parse(serializedInput) as JsonValue), buildJobToken };
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
    initializers: [runcLauncherInitializer(config), buildKitConfigInitializer(config, input.build)],
    jobClass: 'build',
    labels: { 'compartment.dev/job-class': 'build' },
    namespace: config.namespace,
    ...(input.onProgressLine === undefined ? {} : { onLogLine: createLiveLogReporter(input.onProgressLine) }),
    priorityClassName: 'compartment-platform',
    resources: config.runnerResources,
    scheduling: config.scheduling,
    securityProfile: 'restricted',
    sidecars: [buildKitSidecar(config)],
    timeoutMs: config.timeoutMs,
  };
}

function createLiveLogReporter(
  reporter: (line: DockerProgressLine) => void | Promise<void>,
): (line: string) => Promise<void> {
  return async (line: string): Promise<void> => {
    const record: WorkerBuildJobLogRecord | undefined = readBuildLogRecord(line);
    if (record?.type === 'progress') {
      await reporter(record.progress);
    }
  };
}

function buildJobEnvironment(input: RunWorkerBuildJobInput): Record<string, string> {
  return {
    [buildJobInputEnvironmentName]: JSON.stringify(input.build),
    [buildJobTokenEnvironmentName]: input.jobToken,
    BUILDKIT_ADDR: buildKitAddress,
    TMPDIR: '/tmp',
  };
}

function buildJobVolumes(): KubeJobEmptyDirVolume[] {
  return [
    { name: 'buildkit-config' },
    { name: 'buildkit-data' },
    { name: 'buildkit-tmp' },
    { name: 'buildkit-run' },
    { name: 'buildkit-tools' },
    { containerMountPath: '/tmp', name: 'tmp' },
  ];
}

function buildKitConfigInitializer(config: WorkerBuildSandboxConfig, build: WorkerBuildJobInput): KubeJobInitializer {
  const registryHost: string | null = readInsecureBuildCacheRegistryHost(build);
  const script: string =
    registryHost === null
      ? ': > /buildkit-config/buildkitd.toml'
      : `printf '%s\\n' '[registry."${registryHost}"]' '  http = true' > /buildkit-config/buildkitd.toml`;
  return {
    args: ['-c', script],
    command: ['sh'],
    image: config.runnerImage,
    name: 'prepare-buildkit-config',
    volumeMounts: [{ mountPath: '/buildkit-config', name: 'buildkit-config' }],
  };
}

function readInsecureBuildCacheRegistryHost(build: WorkerBuildJobInput): string | null {
  if (!build.docker.pushImageInsecureRegistry) {
    return null;
  }
  const cacheImageRef: string | undefined = build.docker.cacheImageRef;
  if (cacheImageRef === undefined) {
    return null;
  }
  const registryHost: string = cacheImageRef.split('/', 1)[0] ?? '';
  if (!/^[a-z0-9.-]+(?::[0-9]+)?$/u.test(registryHost)) {
    throw new Error('Build cache references require a valid internal registry host.');
  }
  return registryHost;
}

function runcLauncherInitializer(config: WorkerBuildSandboxConfig): KubeJobInitializer {
  return {
    args: ['/usr/local/bin/runc-no-new-keyring', '/buildkit-tools/runc-no-new-keyring'],
    command: ['cp'],
    image: config.runnerImage,
    name: 'prepare-buildkit-tools',
    volumeMounts: [{ mountPath: '/buildkit-tools', name: 'buildkit-tools' }],
  };
}

function buildKitSidecar(config: WorkerBuildSandboxConfig): KubeJobSidecar {
  return {
    args: buildKitSidecarArgs(config.gcKeepStorageMb),
    command: ['buildkitd'],
    env: { HOME: '/home/user', XDG_RUNTIME_DIR: '/run/user/1000' },
    image: config.buildKitImage,
    name: 'buildkit',
    resources: config.buildKitResources,
    securityProfile: 'userns-buildkit',
    volumeMounts: [
      { mountPath: '/home/user/.local/share/buildkit', name: 'buildkit-data' },
      { mountPath: '/buildkit-config', name: 'buildkit-config', readOnly: true },
      { mountPath: '/home/user/.local/tmp', name: 'buildkit-tmp' },
      { mountPath: '/run/user/1000', name: 'buildkit-run' },
      { mountPath: '/buildkit-tools', name: 'buildkit-tools', readOnly: true },
      { mountPath: '/tmp', name: 'tmp' },
    ],
  };
}

function buildKitSidecarArgs(gcKeepStorageMb: number): string[] {
  return [
    '--config',
    '/buildkit-config/buildkitd.toml',
    '--root',
    '/home/user/.local/share/buildkit',
    '--addr',
    buildKitAddress,
    '--oci-worker-snapshotter=native',
    '--oci-worker-binary=/buildkit-tools/runc-no-new-keyring',
    '--oci-worker-gc-keepstorage',
    String(gcKeepStorageMb),
  ];
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

function readBuildLogRecords(logs: string): WorkerBuildJobLogRecord[] {
  return logs.split('\n').flatMap((line: string): WorkerBuildJobLogRecord[] => {
    const record: WorkerBuildJobLogRecord | undefined = readBuildLogRecord(line);
    return record === undefined ? [] : [record];
  });
}

function readBuildLogRecord(line: string): WorkerBuildJobLogRecord | undefined {
  try {
    return workerBuildJobLogRecordSchema.parse(JSON.parse(line) as JsonValue);
  } catch {
    return undefined;
  }
}
