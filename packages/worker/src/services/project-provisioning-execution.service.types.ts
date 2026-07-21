import type { KubeManifest, KubeObservedManifest } from '@compartment/kube-runtime';

export interface ProjectProvisioningResult {
  message?: string | undefined;
  status: 'failed' | 'succeeded';
}

export interface ProjectProvisioningCleanupObservation {
  desired: KubeManifest;
  live: KubeObservedManifest | null;
}
