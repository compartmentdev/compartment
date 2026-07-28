import type { KubeManifest } from './kube-runtime.types';

export interface ApplyBundle {
  createBeforeApply?: KubeManifest[] | undefined;
  deleteAfterApply?: KubeManifest[] | undefined;
  objects: KubeManifest[];
  force?: boolean | undefined;
}
