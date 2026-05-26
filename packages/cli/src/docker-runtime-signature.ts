import {
  selfHostedRuntimeImageSignaturePolicy,
  type SelfHostedRuntimeImageSignaturePolicy,
  type SystemServiceName,
} from '@compartment/contracts';
import type { JsonValue } from '@compartment/utils';
import { readCosignCommand } from './bundled-cosign';
import { readNonCompartmentEnvironment } from './command-environment';
import { readCommandOutput, runCommand } from './command-runner';
import type { CommandResult } from './command-runner.types';
import { runDockerCommand, runQuietDockerCommand } from './docker-command';
import type {
  PullVerifiedRemoteSelfHostedRuntimeImagesInput,
  VerifyLocalSelfHostedRuntimeImageSignaturesInput,
} from './docker-runtime-signature.types';
import type { DockerExecutionContext } from './docker-runtime.types';
import { readJsonValue } from './json.helpers';
import type { SelfHostedImageRefs } from './self-hosted-env.types';

const imageDigestPattern: RegExp = /^sha256:[a-f0-9]{64}$/u;
const imageDigestRefPattern: RegExp = /^[^@]+@sha256:[a-f0-9]{64}$/u;
const trustedSelfHostedRuntimeImageSignaturePolicy: SelfHostedRuntimeImageSignaturePolicy =
  selfHostedRuntimeImageSignaturePolicy;

export async function pullVerifiedRemoteSelfHostedRuntimeImages(
  input: PullVerifiedRemoteSelfHostedRuntimeImagesInput,
): Promise<CommandResult | null> {
  for (const imageRef of readSelectedSignedSelfHostedRuntimeImageRefs(
    input.imageRefs,
    input.services,
    input.includeRuntimeProbeImage ?? false,
  )) {
    const digestRef: string = await readRemoteSelfHostedRuntimeImageDigestRef(input.context, imageRef);
    await verifySelfHostedRuntimeImageSignature(digestRef);

    const pullResult: CommandResult = await runDockerCommand(input.context, ['pull', digestRef]);
    if (pullResult.exitCode !== 0) {
      return pullResult;
    }

    const tagResult: CommandResult = await runDockerCommand(input.context, ['tag', digestRef, imageRef]);
    if (tagResult.exitCode !== 0) {
      return tagResult;
    }
  }

  return null;
}

export async function verifyLocalSelfHostedRuntimeImageSignatures(
  input: VerifyLocalSelfHostedRuntimeImageSignaturesInput,
): Promise<void> {
  for (const imageRef of readSelectedSignedSelfHostedRuntimeImageRefs(
    input.imageRefs,
    input.services,
    input.includeRuntimeProbeImage ?? false,
  )) {
    const digestRef: string = await readLocalSelfHostedRuntimeImageDigestRef(input.context, imageRef);
    await verifySelfHostedRuntimeImageSignature(digestRef);
  }
}

export function createSelfHostedRuntimeImageSignatureWarning(error: Error | string): string {
  const message: string = error instanceof Error ? error.message : error;
  return `Build worker image signature could not be verified. The control plane can still start; source builds may stay unavailable until the signed worker image is available.\n${message}`;
}

async function readLocalSelfHostedRuntimeImageDigestRef(
  context: DockerExecutionContext,
  imageRef: string,
): Promise<string> {
  const inspectResult: CommandResult = await runQuietDockerCommand(context, [
    'image',
    'inspect',
    '--format',
    '{{json .RepoDigests}}',
    imageRef,
  ]);
  if (inspectResult.exitCode !== 0) {
    throw createCommandError(
      `Expected pulled self-hosted image ${imageRef} before signature verification.`,
      inspectResult,
    );
  }

  const digestRef: string | null = readMatchingImageDigestRef(imageRef, readDockerImageRepoDigests(inspectResult));
  if (digestRef === null) {
    throw new Error(
      `Expected pulled self-hosted image ${imageRef} to include a repository digest for signature verification.`,
    );
  }

  return digestRef;
}

async function readRemoteSelfHostedRuntimeImageDigestRef(
  context: DockerExecutionContext,
  imageRef: string,
): Promise<string> {
  const inspectResult: CommandResult = await runQuietDockerCommand(context, [
    'buildx',
    'imagetools',
    'inspect',
    '--format',
    '{{ printf "%s" .Manifest.Digest }}',
    imageRef,
  ]);
  if (inspectResult.exitCode !== 0) {
    throw createCommandError(
      `Expected remote self-hosted image ${imageRef} before signature verification.`,
      inspectResult,
    );
  }

  const digest: string = inspectResult.stdout.trim();
  if (!imageDigestPattern.test(digest)) {
    throw createCommandError('Docker returned invalid remote digest metadata for a self-hosted image.', inspectResult);
  }

  return `${readImageRepository(imageRef)}@${digest}`;
}

async function verifySelfHostedRuntimeImageSignature(imageRef: string): Promise<void> {
  if (!imageDigestRefPattern.test(imageRef)) {
    throw new Error(`Expected an immutable digest image reference before signature verification: ${imageRef}`);
  }

  const cosignCommand: readonly string[] = await readCosignCommand();
  const result: CommandResult = await runCommand(
    [
      ...cosignCommand,
      'verify',
      trustedSelfHostedRuntimeImageSignaturePolicy.cosignBundleFormatFlag,
      '--certificate-oidc-issuer',
      trustedSelfHostedRuntimeImageSignaturePolicy.certificateOidcIssuer,
      '--certificate-identity-regexp',
      trustedSelfHostedRuntimeImageSignaturePolicy.certificateIdentityRegexp,
      imageRef,
    ],
    readNonCompartmentEnvironment(process.env),
  );
  if (result.exitCode !== 0) {
    throw createCommandError(`Failed to verify self-hosted image signature for ${imageRef}.`, result);
  }
}

function readDockerImageRepoDigests(inspectResult: CommandResult): string[] {
  const parsed: JsonValue | null = readJsonValue(inspectResult.stdout);
  if (!Array.isArray(parsed)) {
    throw createCommandError(
      'Docker returned invalid repository digest metadata for a self-hosted image.',
      inspectResult,
    );
  }

  return parsed.filter((entry: JsonValue): entry is string => typeof entry === 'string' && entry.includes('@sha256:'));
}

function readMatchingImageDigestRef(imageRef: string, digestRefs: readonly string[]): string | null {
  const repository: string = readImageRepository(imageRef);
  const comparableRepository: string = readComparableImageRepository(repository);
  const digestRef: string | undefined = digestRefs.find(
    (candidateDigestRef: string): boolean =>
      readComparableImageRepository(readImageRepository(candidateDigestRef)) === comparableRepository,
  );

  return digestRef === undefined ? null : `${repository}@${readImageDigest(digestRef)}`;
}

function readSelectedSignedSelfHostedRuntimeImageRefs(
  imageRefs: SelfHostedImageRefs,
  services: readonly SystemServiceName[],
  includeRuntimeProbeImage: boolean,
): string[] {
  const selectedImageRefs: string[] = [];

  for (const serviceName of services) {
    const imageRef: string | null = readSignedSelfHostedRuntimeServiceImageRef(imageRefs, serviceName);
    if (imageRef !== null && !selectedImageRefs.includes(imageRef)) {
      selectedImageRefs.push(imageRef);
    }
  }

  if (includeRuntimeProbeImage && !selectedImageRefs.includes(imageRefs.runtimeProbeImage)) {
    selectedImageRefs.push(imageRefs.runtimeProbeImage);
  }

  return selectedImageRefs;
}

function readSignedSelfHostedRuntimeServiceImageRef(
  imageRefs: SelfHostedImageRefs,
  serviceName: SystemServiceName,
): string | null {
  switch (serviceName) {
    case 'api':
      return imageRefs.apiImage;
    case 'caddy':
      return imageRefs.caddyImage;
    case 'edge':
      return imageRefs.edgeImage;
    case 'registry-auth':
    case 'worker':
      return imageRefs.workerImage;
    case 'builder':
    case 'node':
    case 'postgres':
    case 'registry':
      return null;
  }
}

function readImageRepository(imageRef: string): string {
  const digestSeparatorIndex: number = imageRef.indexOf('@');
  if (digestSeparatorIndex !== -1) {
    return imageRef.slice(0, digestSeparatorIndex);
  }

  const lastSlashIndex: number = imageRef.lastIndexOf('/');
  const lastColonIndex: number = imageRef.lastIndexOf(':');
  return lastColonIndex <= lastSlashIndex ? imageRef : imageRef.slice(0, lastColonIndex);
}

function readComparableImageRepository(repository: string): string {
  const firstSlashIndex: number = repository.indexOf('/');
  if (firstSlashIndex === -1) {
    return repository;
  }

  const registryHost: string = repository.slice(0, firstSlashIndex);
  if (registryHost === 'docker.io' || registryHost === 'index.docker.io') {
    return repository.slice(firstSlashIndex + 1);
  }

  return repository;
}

function readImageDigest(imageRef: string): string {
  const digestSeparatorIndex: number = imageRef.indexOf('@');
  return digestSeparatorIndex === -1 ? imageRef : imageRef.slice(digestSeparatorIndex + 1);
}

function createCommandError(prefix: string, result: CommandResult): Error {
  const outputText: string = readCommandOutput(result);
  return new Error(outputText === '' ? prefix : `${prefix}\n${outputText}`);
}
