import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveCompartmentServiceRunExecution } from '@compartment/contracts';
import {
  buildDockerImage,
  type DockerBuildImageInput,
  type DockerBuildImageResult,
  type DockerRegistryCredentials,
} from '@compartment/docker';
import { createCompartmentBinaryRequester, getArtifactSourceArchive } from '@compartment/sdk';
import { readWorkerBuildJobInputEnvironment, writeWorkerBuildJobLog } from './services/worker-build-job.service';
import type {
  WorkerBuildJobDockerInput,
  WorkerBuildJobInput,
  WorkerSourceBuildJobInput,
} from './services/worker-build-job.types';
import { prepareServiceDirectory } from './services/worker-source.service';
import type { PreparedWorkerSource, PreparedWorkerSourceBuildInput } from './services/worker-source.service.types';

class BuildJobDockerImageInput implements DockerBuildImageInput {
  appPath?: string | undefined;
  buildAptPackages?: string[] | undefined;
  buildCommand?: string | undefined;
  buildEnv?: Record<string, string> | undefined;
  cacheImageRef?: string | undefined;
  contextDirectory!: string;
  dockerfilePath?: string | undefined;
  imageTag!: string;
  labels?: Record<string, string> | undefined;
  onProgressLine?: ((progress: { message: string; stream: 'stderr' | 'stdout' }) => void) | undefined;
  packer!: 'dockerfile' | 'railpack' | 'static';
  pushImageInsecureRegistry?: boolean | undefined;
  pushImageTag?: string | undefined;
  pushRegistryCredentials?: DockerRegistryCredentials | undefined;
  runtimeAptPackages?: string[] | undefined;
  staticOutputDirectory?: string | undefined;

  constructor(input: DockerBuildImageInput) {
    Object.assign(this, input);
  }
}

async function main(): Promise<void> {
  const environment: { input: WorkerBuildJobInput; internalToken: string } = readWorkerBuildJobInputEnvironment(
    process.env,
  );
  const result: DockerBuildImageResult =
    environment.input.kind === 'source'
      ? await buildSourceImage(environment.input, environment.internalToken)
      : await buildRegistryVerificationImage(environment.input.dockerfile, environment.input.docker);
  writeWorkerBuildJobLog({ result, type: 'result' });
}

async function buildSourceImage(
  input: WorkerSourceBuildJobInput,
  internalToken: string,
): Promise<DockerBuildImageResult> {
  const directory: string = await mkdtemp(join(tmpdir(), 'compartment-build-job-'));
  try {
    const archive: Buffer = await getArtifactSourceArchive(
      createCompartmentBinaryRequester({ apiUrl: input.apiUrl, internalToken }),
      input.artifactId,
    );
    const prepared: PreparedWorkerSource = await prepareServiceDirectory(
      directory,
      archive,
      input.service,
      input.service.build,
      input.service.requiresRoutesFile,
    );
    resolveCompartmentServiceRunExecution(input.service.run, prepared.packer, input.service.path);
    return await buildDockerImage(buildDockerInput(input.docker, prepared));
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

async function buildRegistryVerificationImage(
  dockerfile: string,
  docker: WorkerBuildJobDockerInput,
): Promise<DockerBuildImageResult> {
  const directory: string = await mkdtemp(join(tmpdir(), 'compartment-registry-build-job-'));
  try {
    const dockerfilePath: string = join(directory, 'Dockerfile');
    await writeFile(dockerfilePath, dockerfile, 'utf8');
    return await buildDockerImage({
      ...docker,
      contextDirectory: directory,
      dockerfilePath,
      onProgressLine: reportProgress,
      packer: 'dockerfile',
    });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

function buildDockerInput(docker: WorkerBuildJobDockerInput, prepared: PreparedWorkerSource): DockerBuildImageInput {
  const sourceBuildInput: PreparedWorkerSourceBuildInput | undefined = requirePreparedSourceBuildInput(prepared);
  return new BuildJobDockerImageInput({
    ...docker,
    ...(sourceBuildInput ?? {}),
    ...(prepared.buildAptPackages.length === 0 ? {} : { buildAptPackages: prepared.buildAptPackages }),
    ...(prepared.buildCommand === undefined ? {} : { buildCommand: prepared.buildCommand }),
    contextDirectory: prepared.buildContextDirectory,
    ...(prepared.dockerfilePath === undefined ? {} : { dockerfilePath: prepared.dockerfilePath }),
    onProgressLine: reportProgress,
    packer: prepared.packer,
    ...(prepared.runtimeAptPackages.length === 0 ? {} : { runtimeAptPackages: prepared.runtimeAptPackages }),
  });
}

function requirePreparedSourceBuildInput(prepared: PreparedWorkerSource): PreparedWorkerSourceBuildInput | undefined {
  if (prepared.packer !== 'static' || prepared.sourceBuildInput?.staticOutputDirectory !== undefined) {
    return prepared.sourceBuildInput;
  }
  throw new Error('Static services must resolve build.outputDirectory before image build.');
}

function reportProgress(progress: { message: string; stream: 'stderr' | 'stdout' }): void {
  writeWorkerBuildJobLog({ progress, type: 'progress' });
}

void main().catch((error: Error): void => {
  writeWorkerBuildJobLog({
    message: error.message,
    type: 'failure',
  });
  process.exitCode = 1;
});
