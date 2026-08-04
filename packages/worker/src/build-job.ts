import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readCompartmentArtifactImageDigest,
  resolveCompartmentServiceRunExecution,
  type WorkerUploadArtifactSbomResponse,
} from '@compartment/contracts';
import {
  buildDockerImage,
  scanDockerImageSbom,
  type DockerBuildImageInput,
  type DockerBuildImageResult,
  type DockerBuildPacker,
  type DockerSbom,
  type DockerRegistryCredentials,
} from '@compartment/docker';
import {
  createCompartmentBinaryRequester,
  createCompartmentRequester,
  getArtifactSourceArchive,
  uploadArtifactSbom,
} from '@compartment/sdk';
import { readWorkerBuildJobInputEnvironment, writeWorkerBuildJobLog } from './services/worker-build-job.service';
import type {
  WorkerBuildJobDockerInput,
  WorkerBuildJobInput,
  WorkerSourceBuildJobInput,
} from './services/worker-build-job.types';
import { prepareServiceDirectory } from './services/worker-source.service';
import type { PreparedWorkerSource, PreparedWorkerSourceBuildInput } from './services/worker-source.service.types';

type WorkerDockerBoundaryInput = Pick<
  DockerBuildImageInput,
  | 'buildCacheKey'
  | 'buildEnv'
  | 'buildSecretFingerprint'
  | 'cacheImageRef'
  | 'imageTag'
  | 'labels'
  | 'pushImageInsecureRegistry'
  | 'pushImageTag'
  | 'pushRegistryCredentials'
>;

class BuildJobDockerImageInput implements DockerBuildImageInput {
  appPath?: string | undefined;
  buildAptPackages?: string[] | undefined;
  buildCacheKey?: string | undefined;
  buildCommand?: string | undefined;
  buildEnv?: Record<string, string> | undefined;
  buildSecretFingerprint?: string | undefined;
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
  const environment: { input: WorkerBuildJobInput; buildJobToken: string } = readWorkerBuildJobInputEnvironment(
    process.env,
  );
  delete process.env.COMPARTMENT_BUILD_JOB_INPUT;
  delete process.env.COMPARTMENT_BUILD_JOB_INTERNAL_TOKEN;
  const result: DockerBuildImageResult =
    environment.input.kind === 'source'
      ? await buildSourceImage(environment.input, environment.buildJobToken)
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
    reportResolvedBuildStrategy(input, prepared);
    const result: DockerBuildImageResult = await buildDockerImage(buildDockerInput(input.docker, prepared));
    await scanAndPersistSbom(input, internalToken, result);
    return result;
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

async function scanAndPersistSbom(
  input: WorkerSourceBuildJobInput,
  internalToken: string,
  result: DockerBuildImageResult,
): Promise<void> {
  const scanImageRef: string = retargetImageDigest(result.imageRef, input.docker.pushImageTag);
  writeWorkerBuildJobLog({ progress: { message: 'Generating mandatory SBOM.', stream: 'stderr' }, type: 'progress' });
  const sbom: DockerSbom = await scanDockerImageSbom(
    scanImageRef,
    requireScanRegistryCredentials(input.docker),
    input.docker.pushImageInsecureRegistry,
  );
  const response: WorkerUploadArtifactSbomResponse = await uploadArtifactSbom(
    createCompartmentRequester({ apiUrl: input.apiUrl, internalToken }),
    input.artifactId,
    { digest: sbom.digest, imageDigest: readImageDigest(result.imageRef), sbomJson: sbom.json },
  );
  if (!response.stored) {
    throw new Error(`Build artifact ${input.artifactId} did not accept its SBOM.`);
  }
  writeWorkerBuildJobLog({ progress: { message: 'Mandatory SBOM stored.', stream: 'stderr' }, type: 'progress' });
}

function requireScanRegistryCredentials(docker: WorkerBuildJobDockerInput): DockerRegistryCredentials {
  if (docker.scanRegistryCredentials === undefined) {
    throw new Error('Source build SBOM scanning requires pull-only registry credentials.');
  }
  return docker.scanRegistryCredentials;
}

function retargetImageDigest(imageRef: string, targetTag: string): string {
  return `${targetTag}@${readImageDigest(imageRef)}`;
}

function readImageDigest(imageRef: string): string {
  const digest: string | null = readCompartmentArtifactImageDigest(imageRef);
  if (digest === null) {
    throw new Error('SBOM scanning requires a digest-pinned image.');
  }
  return digest;
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
      ...projectDockerBuildInput(docker),
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
    ...projectDockerBuildInput(docker),
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

function projectDockerBuildInput(docker: WorkerBuildJobDockerInput): WorkerDockerBoundaryInput {
  return {
    buildCacheKey: docker.buildCacheKey,
    buildEnv: docker.buildEnv,
    buildSecretFingerprint: docker.buildSecretFingerprint,
    cacheImageRef: docker.cacheImageRef,
    imageTag: docker.imageTag,
    labels: docker.labels,
    pushImageInsecureRegistry: docker.pushImageInsecureRegistry,
    pushImageTag: docker.pushImageTag,
    pushRegistryCredentials: docker.pushRegistryCredentials,
  };
}

function requirePreparedSourceBuildInput(prepared: PreparedWorkerSource): PreparedWorkerSourceBuildInput | undefined {
  if (prepared.packer !== 'static' || prepared.sourceBuildInput?.staticOutputDirectory !== undefined) {
    return prepared.sourceBuildInput;
  }
  throw new Error('Static services must resolve build.outputDirectory before image build.');
}

function reportResolvedBuildStrategy(input: WorkerSourceBuildJobInput, prepared: PreparedWorkerSource): void {
  resolveCompartmentServiceRunExecution(input.service.run, prepared.packer, input.service.path);
  reportProgress({ message: `Build strategy: ${readBuildStrategyLabel(prepared.packer)}.`, stream: 'stderr' });
}

function reportProgress(progress: { message: string; stream: 'stderr' | 'stdout' }): void {
  writeWorkerBuildJobLog({ progress, type: 'progress' });
}

function readBuildStrategyLabel(packer: DockerBuildPacker): string {
  if (packer === 'dockerfile') {
    return 'Dockerfile';
  }
  if (packer === 'railpack') {
    return 'Railpack';
  }
  return 'Railpack static';
}

void main().catch((error: Error): void => {
  writeWorkerBuildJobLog({
    message: error.message,
    type: 'failure',
  });
  process.exitCode = 1;
});
