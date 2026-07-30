import {
  selfHostedRuntimeImageSignaturePolicy,
  type SelfHostedRuntimeImageSignaturePolicy,
} from '@compartment/contracts';
import type { JsonValue } from '@compartment/utils';
import { parse } from 'yaml';
import { readCosignCommand } from '../bundled-cosign';
import { readNonCompartmentEnvironment } from '../command-environment';
import { runCommandWithTimeout } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import { buildHelmCommand } from './kubernetes-command.support';
import { createImageTrustCommandError } from './kubernetes-image-trust-error';
import { readYamlFile } from './yaml-file';
import { kubernetesPlatformImageNames } from './kubernetes-platform-image-names';
import type { KubernetesPlatformImageName } from './kubernetes-platform-image.types';
import { writeKubernetesInstallValues } from './kubernetes-install-helm.service';
import type {
  KubernetesInstallImageTrustInput,
  KubernetesImageTrustJsonObject,
  KubernetesPlatformImageValueFields,
  KubernetesPlatformImageValues,
  KubernetesReleaseImageTrustInput,
  KubernetesVerifiedImageValue,
  KubernetesVerifiedPlatformImageValues,
  ResolvedKubernetesPlatformImage,
} from './kubernetes-image-trust.service.types';
import { readKubernetesReleaseValues } from './kubernetes-release-values.service';

const imageDigestPattern: RegExp = /^sha256:[a-f0-9]{64}$/u;
export async function writeVerifiedKubernetesInstallImageValues(
  input: KubernetesInstallImageTrustInput,
): Promise<void> {
  const chartValues: JsonValue = await readChartValues(input.chartPath);
  const overrideValues: JsonValue[] = await Promise.all(input.overrideValuesPaths.map(readImageTrustValuesFile));
  await writeVerifiedPlatformImageValues(input.outputPath, chartValues, overrideValues);
}

export async function writeVerifiedKubernetesReleaseImageValues(
  input: KubernetesReleaseImageTrustInput,
): Promise<void> {
  const releaseValues: JsonValue = await readKubernetesReleaseValues(input);
  const overrideValues: JsonValue[] = await Promise.all(input.operatorValuesPaths.map(readImageTrustValuesFile));
  await writeVerifiedPlatformImageValues(input.outputPath, releaseValues, overrideValues);
}

async function readChartValues(chartPath: string): Promise<JsonValue> {
  const result: CommandResult = await runCommandWithTimeout(
    buildHelmCommand({}, ['show', 'values', chartPath]),
    30_000,
  );
  if (result.exitCode !== 0) {
    throw createImageTrustCommandError(
      `Failed to read Helm chart values from "${chartPath}" before platform image verification.`,
      result,
    );
  }
  return parse(result.stdout) as JsonValue;
}

async function readImageTrustValuesFile(path: string): Promise<JsonValue> {
  return await readYamlFile(path, 'operator values file');
}

async function writeVerifiedPlatformImageValues(
  outputPath: string,
  baseValues: JsonValue,
  overrideValues: readonly JsonValue[],
): Promise<void> {
  const effectiveImages: KubernetesPlatformImageValues = readEffectivePlatformImages(baseValues, overrideValues);
  const verifiedDigests: Map<string, string> = new Map<string, string>();
  const verifiedImages: Record<KubernetesPlatformImageName, KubernetesVerifiedImageValue> = createEmptyVerifiedImages();
  for (const imageName of kubernetesPlatformImageNames) {
    const resolvedImage: ResolvedKubernetesPlatformImage = resolvePlatformImage(effectiveImages[imageName], imageName);
    let digest: string | undefined = verifiedDigests.get(resolvedImage.imageRef);
    if (digest === undefined) {
      digest = await verifyPlatformImage(resolvedImage);
      verifiedDigests.set(resolvedImage.imageRef, digest);
    }
    verifiedImages[imageName] = { digest };
  }
  const values: KubernetesVerifiedPlatformImageValues = { images: verifiedImages };
  await writeKubernetesInstallValues(outputPath, values);
}

function createEmptyVerifiedImages(): Record<KubernetesPlatformImageName, KubernetesVerifiedImageValue> {
  return {
    api: { digest: '' },
    caddy: { digest: '' },
    dns01Solver: { digest: '' },
    edge: { digest: '' },
    worker: { digest: '' },
  };
}

function readEffectivePlatformImages(
  baseValues: JsonValue,
  overrideValues: readonly JsonValue[],
): KubernetesPlatformImageValues {
  return {
    api: readEffectiveImage(baseValues, overrideValues, 'api'),
    caddy: readEffectiveImage(baseValues, overrideValues, 'caddy'),
    dns01Solver: readEffectiveImage(baseValues, overrideValues, 'dns01Solver'),
    edge: readEffectiveImage(baseValues, overrideValues, 'edge'),
    worker: readEffectiveImage(baseValues, overrideValues, 'worker'),
  };
}

function readEffectiveImage(
  baseValues: JsonValue,
  overrideValues: readonly JsonValue[],
  imageName: KubernetesPlatformImageName,
): KubernetesPlatformImageValueFields {
  return overrideValues.reduce(
    (image: KubernetesPlatformImageValueFields, values: JsonValue): KubernetesPlatformImageValueFields => ({
      ...image,
      ...readImageValueFields(values, imageName),
    }),
    readImageValueFields(baseValues, imageName),
  );
}

function readImageValueFields(
  values: JsonValue,
  imageName: KubernetesPlatformImageName,
): KubernetesPlatformImageValueFields {
  const root: KubernetesImageTrustJsonObject = readImageTrustObject(values, 'Helm values');
  const imagesValue: JsonValue | undefined = root.images;
  if (imagesValue === undefined) {
    return {};
  }
  const images: KubernetesImageTrustJsonObject = readImageTrustObject(imagesValue, 'Helm images values');
  const imageValue: JsonValue | undefined = images[imageName];
  if (imageValue === undefined) {
    return {};
  }
  const image: KubernetesImageTrustJsonObject = readImageTrustObject(imageValue, `Helm images.${imageName} values`);
  return {
    ...readOptionalStringField(image, 'digest'),
    ...readOptionalStringField(image, 'repository'),
    ...readOptionalStringField(image, 'tag'),
  };
}

function readOptionalStringField(
  value: KubernetesImageTrustJsonObject,
  field: keyof KubernetesPlatformImageValueFields,
): KubernetesPlatformImageValueFields {
  if (!Object.hasOwn(value, field)) {
    return {};
  }
  const fieldValue: JsonValue | undefined = value[field];
  if (typeof fieldValue !== 'string') {
    throw new Error(`Expected Helm image ${field} to be a string.`);
  }
  return { [field]: fieldValue };
}

function resolvePlatformImage(
  image: KubernetesPlatformImageValueFields,
  imageName: KubernetesPlatformImageName,
): ResolvedKubernetesPlatformImage {
  const repository: string = requireNonEmptyImageField(image.repository, imageName, 'repository');
  const digest: string | undefined = image.digest === '' ? undefined : image.digest;
  if (digest !== undefined) {
    if (!imageDigestPattern.test(digest)) {
      throw new Error(`Expected images.${imageName}.digest to be an empty string or a sha256 digest.`);
    }
    return { expectedDigest: digest, imageRef: `${repository}@${digest}` };
  }
  const tag: string = requireNonEmptyImageField(image.tag, imageName, 'tag');
  return { imageRef: `${repository}:${tag}` };
}

function requireNonEmptyImageField(
  value: string | undefined,
  imageName: KubernetesPlatformImageName,
  field: 'repository' | 'tag',
): string {
  if (value === undefined || value.trim() === '') {
    throw new Error(`Expected images.${imageName}.${field} before platform image verification.`);
  }
  return value;
}

async function verifyPlatformImage(image: ResolvedKubernetesPlatformImage): Promise<string> {
  const cosignCommand: readonly string[] = await readCosignCommand();
  const result: CommandResult = await runCommandWithTimeout(
    buildCosignVerifyCommand(cosignCommand, image.imageRef),
    120_000,
    readNonCompartmentEnvironment(process.env),
  );
  if (result.exitCode !== 0) {
    throw createImageTrustCommandError(`Failed to verify platform image signature for ${image.imageRef}.`, result);
  }
  const digest: string = readVerifiedDigest(result.stdout, image.imageRef);
  if (image.expectedDigest !== undefined && image.expectedDigest !== digest) {
    throw new Error(`Cosign returned a different digest while verifying ${image.imageRef}.`);
  }
  return digest;
}

function buildCosignVerifyCommand(cosignCommand: readonly string[], imageRef: string): string[] {
  const policy: SelfHostedRuntimeImageSignaturePolicy = selfHostedRuntimeImageSignaturePolicy;
  return [
    ...cosignCommand,
    'verify',
    policy.cosignBundleFormatFlag,
    '--certificate-oidc-issuer',
    policy.certificateOidcIssuer,
    '--certificate-identity-regexp',
    policy.certificateIdentityRegexp,
    '--output',
    'json',
    imageRef,
  ];
}

function readVerifiedDigest(output: string, imageRef: string): string {
  const parsed: JsonValue = readImageTrustJson(output, `Cosign returned invalid JSON while verifying ${imageRef}.`);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(`Cosign returned no verified signatures for ${imageRef}.`);
  }
  const digests: Set<string> = new Set<string>(
    parsed.flatMap((entry: JsonValue): string[] => readSignatureDigest(entry, imageRef)),
  );
  if (digests.size === 0) {
    throw new Error(`Cosign returned no verified image signatures for ${imageRef}.`);
  }
  if (digests.size !== 1) {
    throw new Error(`Cosign returned mixed manifest digests while verifying ${imageRef}.`);
  }
  return digests.values().next().value!;
}

function readSignatureDigest(entry: JsonValue, imageRef: string): string[] {
  const signature: KubernetesImageTrustJsonObject = readImageTrustObject(entry, 'Cosign signature');
  const critical: KubernetesImageTrustJsonObject = readImageTrustObject(signature.critical, 'Cosign critical');
  if (critical.type !== 'https://sigstore.dev/cosign/sign/v1') {
    return [];
  }
  const image: KubernetesImageTrustJsonObject = readImageTrustObject(critical.image, 'Cosign critical image');
  const digest: JsonValue | undefined = image['docker-manifest-digest'];
  if (typeof digest !== 'string' || !imageDigestPattern.test(digest)) {
    throw new Error(`Cosign returned an invalid manifest digest while verifying ${imageRef}.`);
  }
  return [digest];
}

function readImageTrustJson(value: string, message: string): JsonValue {
  try {
    return JSON.parse(value) as JsonValue;
  } catch {
    throw new Error(message);
  }
}

function readImageTrustObject(value: JsonValue | undefined, label: string): KubernetesImageTrustJsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Expected ${label} to be an object.`);
  }
  return value;
}
