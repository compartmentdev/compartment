import type { JsonValue } from '@compartment/utils';
import type { KubernetesPlatformImageName } from './kubernetes-platform-image.types';

export interface KubernetesPlatformImageValueFields {
  digest?: string | undefined;
  repository?: string | undefined;
  tag?: string | undefined;
}

export type KubernetesPlatformImageValues = Record<KubernetesPlatformImageName, KubernetesPlatformImageValueFields>;

export interface KubernetesVerifiedImageValue {
  digest: string;
}

export interface KubernetesVerifiedPlatformImageValues {
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
