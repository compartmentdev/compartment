import type { JsonValue } from '@compartment/utils';
import type {
  KubernetesCapsuleImageValueFields,
  KubernetesImageTrustJsonObject,
  KubernetesImageSignaturePolicy,
  ResolvedKubernetesPlatformImage,
} from './kubernetes-image-trust.service.types';
import { readImageTrustObject, readOptionalImageStringField } from './kubernetes-image-trust-values';

const imageDigestPattern: RegExp = /^sha256:[a-f0-9]{64}$/u;
export const capsuleImageSignaturePolicy: KubernetesImageSignaturePolicy = {
  certificateIdentityRegexp:
    '^https://github\\.com/projectcapsule/capsule/\\.github/workflows/docker-publish\\.yml@refs/tags/v0\\.13\\.11$',
  certificateOidcIssuer: 'https://token.actions.githubusercontent.com',
  cosignBundleFormatFlag: '--new-bundle-format=false',
};

interface ResolvedCapsuleImageTrust {
  image: ResolvedKubernetesPlatformImage;
  tag: string;
}

export function resolveEffectiveCapsuleImageTrust(
  baseValues: JsonValue,
  overrideValues: readonly JsonValue[],
): ResolvedCapsuleImageTrust {
  const effective: KubernetesCapsuleImageValueFields = overrideValues.reduce(
    (image: KubernetesCapsuleImageValueFields, values: JsonValue): KubernetesCapsuleImageValueFields => ({
      ...image,
      ...readCapsuleImageValueFields(values),
    }),
    readCapsuleImageValueFields(baseValues),
  );
  const registry: string = requireField(effective.registry, 'registry');
  const repository: string = requireField(effective.repository, 'repository');
  const tag: string = requireField(effective.tag, 'tag');
  const separator: number = tag.lastIndexOf('@');
  if (separator === -1) {
    return { image: { imageRef: `${registry}/${repository}:${tag}` }, tag };
  }
  const digest: string = tag.slice(separator + 1);
  if (!imageDigestPattern.test(digest)) {
    throw new Error('Expected capsule.manager.image.tag to contain a sha256 digest.');
  }
  return {
    image: { expectedDigest: digest, imageRef: `${registry}/${repository}:${tag}` },
    tag: tag.slice(0, separator),
  };
}

function readCapsuleImageValueFields(values: JsonValue): KubernetesCapsuleImageValueFields {
  const root: KubernetesImageTrustJsonObject = readImageTrustObject(values, 'Helm values');
  if (root.capsule === undefined) {
    return {};
  }
  const capsule: KubernetesImageTrustJsonObject = readImageTrustObject(root.capsule, 'Helm capsule values');
  if (capsule.manager === undefined) {
    return {};
  }
  const manager: KubernetesImageTrustJsonObject = readImageTrustObject(capsule.manager, 'Helm capsule.manager values');
  if (manager.image === undefined) {
    return {};
  }
  const image: KubernetesImageTrustJsonObject = readImageTrustObject(
    manager.image,
    'Helm capsule.manager.image values',
  );
  return {
    ...readOptionalImageStringField(image, 'registry'),
    ...readOptionalImageStringField(image, 'repository'),
    ...readOptionalImageStringField(image, 'tag'),
  };
}

function requireField(value: string | undefined, field: 'registry' | 'repository' | 'tag'): string {
  if (value === undefined || value.trim() === '') {
    throw new Error(`Expected capsule.manager.image.${field} before platform image verification.`);
  }
  return value;
}
