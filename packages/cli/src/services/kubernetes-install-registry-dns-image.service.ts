import type { JsonValue } from '@compartment/utils';
import type { KubernetesImageTrustJsonObject } from './kubernetes-image-trust.service.types';
import { readKubernetesReleaseValues } from './kubernetes-release-values.service';
import type { KubernetesInstallDeploymentInput } from './kubernetes-install.service.types';

export async function readRegistryDnsProbeImage(input: KubernetesInstallDeploymentInput): Promise<string> {
  const values: JsonValue = await readProbeImageReleaseValues(input);
  const root: KubernetesImageTrustJsonObject = readJsonObject(values, 'effective Helm release values');
  const images: KubernetesImageTrustJsonObject = readJsonObject(root.images, 'effective Helm release images values');
  const worker: KubernetesImageTrustJsonObject = readJsonObject(
    images.worker,
    'effective Helm release images.worker values',
  );
  const repository: string = readRequiredImageField(worker, 'repository');
  const digest: string | undefined = readOptionalImageField(worker, 'digest');
  return digest === undefined || digest === ''
    ? `${repository}:${readRequiredImageField(worker, 'tag')}`
    : `${repository}@${digest}`;
}

async function readProbeImageReleaseValues(input: KubernetesInstallDeploymentInput): Promise<JsonValue> {
  try {
    return await readKubernetesReleaseValues(input);
  } catch (error) {
    const message: string = error instanceof Error ? error.message : 'Helm release values inspection failed.';
    throw new Error(`Cannot determine the registry DNS probe image from effective Helm release values: ${message}`);
  }
}

function readJsonObject(value: JsonValue | undefined, description: string): KubernetesImageTrustJsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Cannot determine the registry DNS probe image: ${description} must be an object.`);
  }
  return value;
}

function readRequiredImageField(value: KubernetesImageTrustJsonObject, field: 'repository' | 'tag'): string {
  const imageField: string | undefined = readOptionalImageField(value, field);
  if (imageField === undefined || imageField === '') {
    throw new Error(
      `Cannot determine the registry DNS probe image: images.worker.${field} must be a non-empty string.`,
    );
  }
  return imageField;
}

function readOptionalImageField(
  value: KubernetesImageTrustJsonObject,
  field: 'digest' | 'repository' | 'tag',
): string | undefined {
  const imageField: JsonValue | undefined = value[field];
  if (imageField !== undefined && typeof imageField !== 'string') {
    throw new Error(`Cannot determine the registry DNS probe image: images.worker.${field} must be a string.`);
  }
  return imageField?.trim();
}
