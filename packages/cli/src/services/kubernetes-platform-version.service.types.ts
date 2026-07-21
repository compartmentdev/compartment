import type { KubernetesPlatformImageName } from './kubernetes-platform-image.types';

export interface KubernetesPlatformImageVersionValue {
  digest: '';
  tag: string;
}

export interface KubernetesPlatformImageVersionValues {
  images: Record<KubernetesPlatformImageName, KubernetesPlatformImageVersionValue>;
}
