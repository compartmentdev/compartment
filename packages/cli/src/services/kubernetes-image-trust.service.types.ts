import type { JsonValue } from '@compartment/utils';

export type KubernetesPlatformImageName = 'api' | 'caddy' | 'edge' | 'worker';

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
  namespace: string;
  operatorValuesPath: string;
  outputPath: string;
  releaseName: string;
}

export interface KubernetesInstallImageTrustInput {
  chartPath: string;
  operatorValuesPath: string;
  outputPath: string;
}

export interface ResolvedKubernetesPlatformImage {
  expectedDigest?: string | undefined;
  imageRef: string;
  repository: string;
}

export type KubernetesImageTrustJsonObject = Record<string, JsonValue>;
