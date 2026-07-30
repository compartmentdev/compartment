import { Buffer } from 'node:buffer';
import { createHmac } from 'node:crypto';
import {
  buildCompartmentArtifactImageRepository,
  buildCompartmentArtifactImageTag,
  type RegistryInstallVerificationOutput,
} from '@compartment/contracts';
import type { DockerBuildImageResult } from '@compartment/docker';
import { createKubeRuntimeFromEnvironment, type KubeRuntime } from '@compartment/kube-runtime';
import { readWorkerBuildConfig, type WorkerBuildConfig } from './config';
import { issueBuildPushCredential, issueProjectPullCredential } from './registry-credentials';
import type { RegistryCredential } from './registry-credentials.types';
import { runWorkerBuildJob } from './services/worker-build-job.service';
import type { WorkerBuildJobDockerInput } from './services/worker-build-job.types';

const verificationServiceId: string = 'svc_registry_acceptance';

async function main(): Promise<void> {
  const config: WorkerBuildConfig = readWorkerBuildConfig();
  const installationId: string = readInstallationId(process.env.COMPARTMENT_INSTALLATION_ID);
  const verificationProjectId: string = buildVerificationProjectId(installationId);
  const artifactId: string = `acceptance_${Date.now().toString()}`;
  const result: DockerBuildImageResult = await buildVerificationImage(
    createKubeRuntimeFromEnvironment(),
    config,
    verificationProjectId,
    artifactId,
  );
  process.stdout.write(`${JSON.stringify(buildVerificationOutput(config, verificationProjectId, result.imageRef))}\n`);
}

async function buildVerificationImage(
  runtime: KubeRuntime,
  config: WorkerBuildConfig,
  installationId: string,
  artifactId: string,
): Promise<DockerBuildImageResult> {
  const result: DockerBuildImageResult = await runWorkerBuildJob(runtime, config.buildSandbox, {
    build: {
      docker: buildVerificationImageInput(config, installationId, artifactId),
      dockerfile: 'FROM busybox:1.36.1\nCMD ["sh", "-c", "sleep 600"]\n',
      kind: 'registry-verification',
    },
    id: artifactId,
    internalToken: config.runtimeControlToken,
  });
  if (!result.pushed) {
    throw new Error('Registry acceptance image was not pushed.');
  }
  return result;
}

function buildVerificationImageInput(
  config: WorkerBuildConfig,
  installationId: string,
  artifactId: string,
): WorkerBuildJobDockerInput {
  const repository: string = buildCompartmentArtifactImageRepository(installationId, verificationServiceId);
  const nodeImageTag: string = buildNodeImageTag(config, repository, artifactId);
  const pushImageTag: string = buildPushImageTag(config, repository, artifactId);
  const pushCredential: RegistryCredential = buildPushCredential(config, installationId, repository, artifactId);
  return {
    imageTag: nodeImageTag,
    labels: {
      'dev.compartment.acceptance-signature': createAcceptanceSignature(config, nodeImageTag),
    },
    pushImageInsecureRegistry: new URL(config.artifactRegistry.internalUrl).protocol === 'http:',
    pushImageTag,
    pushRegistryCredentials: {
      password: pushCredential.password,
      serverAddress: config.artifactRegistry.internalAddress,
      username: pushCredential.username,
    },
  };
}

function buildNodeImageTag(config: WorkerBuildConfig, repository: string, artifactId: string): string {
  return buildCompartmentArtifactImageTag(config.artifactRegistry.address, repository, artifactId);
}

function buildPushCredential(
  config: WorkerBuildConfig,
  installationId: string,
  repository: string,
  artifactId: string,
): RegistryCredential {
  return issueBuildPushCredential(config.artifactRegistry.credentialSigningKey, installationId, repository, artifactId);
}

function createAcceptanceSignature(config: WorkerBuildConfig, imageTag: string): string {
  return createHmac('sha256', config.artifactRegistry.credentialSigningKey).update(imageTag).digest('base64url');
}

function buildPushImageTag(config: WorkerBuildConfig, repository: string, artifactId: string): string {
  return buildCompartmentArtifactImageTag(config.artifactRegistry.internalAddress, repository, artifactId);
}

function buildVerificationOutput(
  config: WorkerBuildConfig,
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
