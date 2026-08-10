import type { JsonValue } from '@compartment/utils';
import type { SelfHostedRuntimeImageSignaturePolicy } from '@compartment/contracts';
import type { KubernetesPlatformImageName } from './kubernetes-platform-image.types';

export interface KubernetesImageValueFields {
  digest?: string | undefined;
  registry?: string | undefined;
  repository?: string | undefined;
  tag?: string | undefined;
}

export type KubernetesPlatformImageValueFields = KubernetesImageValueFields;

export type KubernetesPlatformImageValues = Record<KubernetesPlatformImageName, KubernetesPlatformImageValueFields>;

export interface KubernetesVerifiedImageValue {
  digest: string;
}

export type KubernetesCapsuleImageValueFields = KubernetesImageValueFields;

export interface KubernetesVerifiedCapsuleImageValue {
  tag: string;
}

export interface KubernetesVerifiedCapsuleManagerValues {
  image: KubernetesVerifiedCapsuleImageValue;
}

export interface KubernetesVerifiedCapsuleImageValues {
  manager: KubernetesVerifiedCapsuleManagerValues;
}

export interface KubernetesVerifiedPlatformImageValues {
  capsule: KubernetesVerifiedCapsuleImageValues;
  images: Record<KubernetesPlatformImageName, KubernetesVerifiedImageValue>;
}

export interface KubernetesReleaseImageTrustInput {
  kubeContext?: string | undefined;
  kubeconfigPath?: string | undefined;
  namespace: string;
  operatorValuesPaths: readonly string[];
  outputPath: string;
  releaseName: string;
}

export interface KubernetesInstallImageTrustInput {
  chartPath: string;
  overrideValuesPaths: readonly string[];
  outputPath: string;
}

export interface ResolvedKubernetesPlatformImage {
  expectedDigest?: string | undefined;
  imageRef: string;
}

export type KubernetesImageTrustJsonObject = Record<string, JsonValue>;

export type KubernetesImageSignaturePolicy = Omit<SelfHostedRuntimeImageSignaturePolicy, 'cosignBundleFormatFlag'> & {
  readonly cosignBundleFormatFlag: '--new-bundle-format' | '--new-bundle-format=false';
};
