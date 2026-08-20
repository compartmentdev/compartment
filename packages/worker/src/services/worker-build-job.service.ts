import type { DockerBuildImageResult, DockerProgressLine } from '@compartment/docker';
import {
  KubeJobLogAttachmentError,
  type KubeJobResult,
  type KubeRunJobOptions,
  type KubeJobSidecar,
  type KubeJobSpec,
  type KubeRuntime,
} from '@compartment/kube-runtime';
import type { WorkerBuildConfig } from '../config';
import { assertBuildSandboxMemoryBudget, buildSandboxVolumes } from './build-sandbox-workspace';
import type {
  RunWorkerBuildJobInput,
  WorkerBuildJobEnvironment,
  WorkerBuildJobInput,
  WorkerBuildJobLogRecord,
  WorkerRegistryVerificationBuildJobInput,
  WorkerSourceBuildJobInput,
} from './worker-build-job.types';
import { readBuildLogRecord, readBuildLogRecords } from './worker-build-log-record';
import { workerJobCommand, workerJobEntrypoints } from '../worker-entrypoints';
import { resolveWorkerBuildKitSeedImage } from './worker-buildkit-seed-cache.service';
import type { WorkerBuildKitSeedResolution } from './worker-buildkit-seed-cache.service.types';
import { readCapturedBuildFailure } from './worker-build-failure';
import { publishSeedCacheFallback, shouldRetryWithPublicSeed } from './worker-buildkit-seed-fallback';

const buildKitAddress: string = 'tcp://127.0.0.1:1234';
const buildJobInputEnvironmentName: string = 'COMPARTMENT_BUILD_JOB_INPUT';
const buildJobCredentialEnvironmentName: string = 'COMPARTMENT_BUILD_JOB_SOURCE_ARCHIVE_CREDENTIAL';

export async function runWorkerBuildJob(
  runtime: Pick<KubeRuntime, 'runJob'>,
  config: WorkerBuildConfig,
  input: RunWorkerBuildJobInput,
): Promise<DockerBuildImageResult> {
  assertBuildSandboxMemoryBudget(config.buildSandbox);
  const progress: BuildProgressStream | undefined =
    input.onProgressLine === undefined ? undefined : new BuildProgressStream(input.onProgressLine);
  const capture: KubeJobResult = await runBuildJobWithSeedFallback(runtime, config, input, progress);
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

async function runBuildJobWithSeedFallback(
  runtime: Pick<KubeRuntime, 'runJob'>,
  config: WorkerBuildConfig,
  input: RunWorkerBuildJobInput,
  progress: BuildProgressStream | undefined,
): Promise<KubeJobResult> {
  const options: KubeRunJobOptions | undefined =
    progress === undefined ? undefined : new WorkerBuildJobRunOptions(progress);
  const seed: WorkerBuildKitSeedResolution = await resolveBuildKitSeedImage(config, input);
  const capture: KubeJobResult = await runtime.runJob(buildKubeJobSpec(config, input, seed.image), undefined, options);
  if (!seed.cacheAvailable || !shouldRetryWithPublicSeed(capture)) {
    return capture;
  }
  await capture.finalize();
  await publishSeedCacheFallback(input);
  return await runtime.runJob(
    buildKubeJobSpec(config, { ...input, id: `${input.id}-seed-fallback` }, config.buildSandbox.seed.image),
    undefined,
    options,
  );
}

async function resolveBuildKitSeedImage(
  config: WorkerBuildConfig,
  input: RunWorkerBuildJobInput,
): Promise<WorkerBuildKitSeedResolution> {
  const seed: WorkerBuildKitSeedResolution = await resolveWorkerBuildKitSeedImage(config.buildSandbox.seed);
  if (!seed.cacheAvailable) {
    await publishSeedCacheFallback(input);
  }
  return seed;
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

export function readWorkerBuildJobInputEnvironment(env: NodeJS.ProcessEnv): WorkerBuildJobEnvironment {
  const serializedInput: string | undefined = env[buildJobInputEnvironmentName];
  if (serializedInput === undefined || serializedInput === '') {
    throw new Error(`${buildJobInputEnvironmentName} is required.`);
  }
  const parsed: Partial<WorkerBuildJobInput> | null = JSON.parse(
    serializedInput,
  ) as Partial<WorkerBuildJobInput> | null;
  if (parsed?.kind === 'registry-verification') {
    return { input: parsed as WorkerRegistryVerificationBuildJobInput, kind: 'registry-verification' };
  }
  if (parsed?.kind !== 'source') {
    throw new Error(`${buildJobInputEnvironmentName} must describe a known build kind.`);
  }
  const sourceArchiveCredential: string | undefined = env[buildJobCredentialEnvironmentName];
  if (sourceArchiveCredential === undefined || sourceArchiveCredential === '') {
    throw new Error(`${buildJobCredentialEnvironmentName} is required for source builds.`);
  }
  return { input: parsed as WorkerSourceBuildJobInput, kind: 'source', sourceArchiveCredential };
}

export function writeWorkerBuildJobLog(record: WorkerBuildJobLogRecord): void {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

function buildKubeJobSpec(config: WorkerBuildConfig, input: RunWorkerBuildJobInput, seedImage: string): KubeJobSpec {
  return {
    cleanupPolicy: 'delete',
    command: workerJobCommand(workerJobEntrypoints.build),
    configMapVolumes: [{ configMapName: config.buildSandbox.buildKitConfigMapName, name: 'buildkit-config' }],
    emptyDirVolumes: buildSandboxVolumes(config.buildSandbox),
    env: buildJobEnvironment(config, input),
    id: input.id,
    image: config.workerImage,
    imageVolumes: [{ name: 'buildkit-seed', pullPolicy: 'IfNotPresent', reference: seedImage }],
    jobClass: 'build',
    labels: { 'compartment.dev/job-class': 'build' },
    namespace: config.buildSandbox.namespace,
    resources: config.buildSandbox.runnerResources,
    scheduling: config.buildSandbox.scheduling,
    securityProfile: 'restricted',
    sidecars: [buildKitSidecar(config)],
    timeoutMs: config.buildSandbox.timeoutMs,
  };
}

function buildJobEnvironment(config: WorkerBuildConfig, input: RunWorkerBuildJobInput): Record<string, string> {
  return {
    [buildJobInputEnvironmentName]: JSON.stringify(input.build),
    ...('sourceArchiveCredential' in input
      ? { [buildJobCredentialEnvironmentName]: input.sourceArchiveCredential }
      : {}),
    BUILDKIT_ADDR: buildKitAddress,
    COMPARTMENT_RAILPACK_BUILDER_IMAGE: config.buildSandbox.seed.railpackBuilderImage,
    COMPARTMENT_RAILPACK_RUNTIME_IMAGE: config.buildSandbox.seed.railpackRuntimeImage,
    TMPDIR: '/tmp',
  };
}

function buildKitSidecar(config: WorkerBuildConfig): KubeJobSidecar {
  return {
    args: [
      '--addr',
      buildKitAddress,
      '--config',
      '/etc/buildkit/buildkitd.toml',
      '--oci-worker=true',
      '--oci-worker-binary=/usr/local/bin/buildkit-runc-gvisor',
      '--oci-worker-gc-keepstorage',
      String(config.buildSandbox.gcKeepStorageMb),
    ],
    command: ['/usr/local/bin/start-seeded-buildkit'],
    env: {
      COMPARTMENT_RAILPACK_BUILDER_IMAGE: config.buildSandbox.seed.railpackBuilderImage,
      COMPARTMENT_RAILPACK_RUNTIME_IMAGE: config.buildSandbox.seed.railpackRuntimeImage,
      HOME: '/tmp',
      TMPDIR: '/buildkit-tmp',
    },
    image: config.workerImage,
    name: 'buildkit',
    resources: config.buildSandbox.buildKitResources,
    volumeMounts: [
      { mountPath: '/var/lib/buildkit', name: 'buildkit-data' },
      { mountPath: '/run', name: 'buildkit-run' },
      { mountPath: '/buildkit-tmp', name: 'buildkit-tmp' },
      { mountPath: '/etc/buildkit/buildkitd.toml', name: 'buildkit-config', readOnly: true, subPath: 'buildkitd.toml' },
      { mountPath: '/var/lib/buildkit-seed', name: 'buildkit-seed', readOnly: true },
    ],
  };
}

class BuildProgressStream {
  private error: Error | null = null;
  private readonly publishedProgressCounts: Map<string, number> = new Map<string, number>();
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
    for (const record of readBuildLogRecords(logs)) {
      if (record.type === 'progress' && !this.consumePublishedProgress(record.progress)) {
        await this.publishProgress(record.progress, false);
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

  private async publishProgress(progress: DockerProgressLine, track: boolean = true): Promise<void> {
    await this.reporter(progress);
    if (track) {
      const signature: string = readProgressSignature(progress);
      this.publishedProgressCounts.set(signature, (this.publishedProgressCounts.get(signature) ?? 0) + 1);
    }
  }

  private consumePublishedProgress(progress: DockerProgressLine): boolean {
    const signature: string = readProgressSignature(progress);
    const count: number = this.publishedProgressCounts.get(signature) ?? 0;
    if (count === 0) {
      return false;
    }
    this.publishedProgressCounts.set(signature, count - 1);
    return true;
  }
}

function readProgressSignature(progress: DockerProgressLine): string {
  return `${progress.stream}\u0000${progress.message}`;
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
