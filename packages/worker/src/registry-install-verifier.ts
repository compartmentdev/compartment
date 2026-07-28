import { Buffer } from 'node:buffer';
import { createHmac } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCompartmentArtifactImageRepository, buildCompartmentArtifactImageTag } from '@compartment/contracts';
import { buildDockerImage, type DockerBuildImageInput, type DockerBuildImageResult } from '@compartment/docker';
import { readWorkerConfig, type WorkerConfig } from './config';
import { issueBuildPushCredential, issueProjectPullCredential } from './registry-credentials';
import type { RegistryCredential } from './registry-credentials.types';
import type {
  RegistryInstallVerificationOutput,
  RegistryVerificationBuildContext,
} from './registry-install-verifier.types';

const verificationServiceId: string = 'svc_registry_acceptance';

async function main(): Promise<void> {
  const config: WorkerConfig = readWorkerConfig();
  const installationId: string = readInstallationId(process.env.COMPARTMENT_INSTALLATION_ID);
  const verificationProjectId: string = buildVerificationProjectId(installationId);
  const artifactId: string = `acceptance_${Date.now().toString()}`;
  const result: DockerBuildImageResult = await buildVerificationImage(config, verificationProjectId, artifactId);
  process.stdout.write(`${JSON.stringify(buildVerificationOutput(config, verificationProjectId, result.imageRef))}\n`);
}

async function buildVerificationImage(
  config: WorkerConfig,
  installationId: string,
  artifactId: string,
): Promise<DockerBuildImageResult> {
  const context: RegistryVerificationBuildContext = await prepareVerificationBuild(config, installationId, artifactId);
  try {
    const result: DockerBuildImageResult = await buildDockerImage(context.buildInput);
    if (!result.pushed) {
      throw new Error('Registry acceptance image was not pushed.');
    }
    return result;
  } finally {
    await rm(context.directory, { force: true, recursive: true });
  }
}

async function prepareVerificationBuild(
  config: WorkerConfig,
  installationId: string,
  artifactId: string,
): Promise<RegistryVerificationBuildContext> {
  const repository: string = buildCompartmentArtifactImageRepository(installationId, verificationServiceId);
  const nodeImageTag: string = buildNodeImageTag(config, repository, artifactId);
  const pushImageTag: string = buildPushImageTag(config, repository, artifactId);
  const pushCredential: RegistryCredential = buildPushCredential(config, installationId, repository, artifactId);
  const directory: string = await mkdtemp(join(tmpdir(), 'compartment-registry-acceptance-'));
  const dockerfilePath: string = join(directory, 'Dockerfile');
  await writeFile(dockerfilePath, 'FROM busybox:1.36.1\nCMD ["sh", "-c", "sleep 600"]\n', 'utf8');
  return {
    buildInput: buildVerificationImageInput(
      config,
      directory,
      dockerfilePath,
      nodeImageTag,
      pushImageTag,
      pushCredential,
    ),
    directory,
  };
}

function buildNodeImageTag(config: WorkerConfig, repository: string, artifactId: string): string {
  return buildCompartmentArtifactImageTag(config.artifactRegistry.address, repository, artifactId);
}

function buildPushCredential(
  config: WorkerConfig,
  installationId: string,
  repository: string,
  artifactId: string,
): RegistryCredential {
  return issueBuildPushCredential(config.artifactRegistry.credentialSigningKey, installationId, repository, artifactId);
}

function buildVerificationImageInput(
  config: WorkerConfig,
  contextDirectory: string,
  dockerfilePath: string,
  imageTag: string,
  pushImageTag: string,
  pushCredential: RegistryCredential,
): DockerBuildImageInput {
  return {
    contextDirectory,
    dockerfilePath,
    imageTag,
    labels: {
      'dev.compartment.acceptance-signature': createAcceptanceSignature(config, imageTag),
    },
    packer: 'dockerfile',
    pushImageInsecureRegistry: new URL(config.artifactRegistry.internalUrl).protocol === 'http:',
    pushImageTag,
    pushRegistryCredentials: {
      password: pushCredential.password,
      serverAddress: config.artifactRegistry.internalAddress,
      username: pushCredential.username,
    },
  };
}

function createAcceptanceSignature(config: WorkerConfig, imageTag: string): string {
  return createHmac('sha256', config.artifactRegistry.credentialSigningKey).update(imageTag).digest('base64url');
}

function buildPushImageTag(config: WorkerConfig, repository: string, artifactId: string): string {
  return buildCompartmentArtifactImageTag(config.artifactRegistry.internalAddress, repository, artifactId);
}

function buildVerificationOutput(
  config: WorkerConfig,
  installationId: string,
  imageRef: string,
): RegistryInstallVerificationOutput {
  const pullCredential: RegistryCredential = issueProjectPullCredential(
    config.artifactRegistry.credentialSigningKey,
    installationId,
  );
  const auth: string = Buffer.from(`${pullCredential.username}:${pullCredential.password}`, 'utf8').toString('base64');
  return {
    dockerConfigJson: JSON.stringify({
      auths: {
        [config.artifactRegistry.address]: {
          auth,
          password: pullCredential.password,
          username: pullCredential.username,
        },
      },
    }),
    imageRef,
  };
}

function readInstallationId(value: string | undefined): string {
  if (value !== undefined && /^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(value)) {
    return value;
  }
  throw new Error('COMPARTMENT_INSTALLATION_ID must be an immutable identifier.');
}

function buildVerificationProjectId(installationId: string): string {
  return `prj_registry_acceptance_${installationId}`;
}

void main();
