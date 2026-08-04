import type { KubeJobVolumeMount, KubeVolumeMount } from './kube-volume.types';
import type { KubeWorkloadScheduling } from './kube-workload-scheduling.types';

export interface KubeLogReference {
  container?: string | undefined;
  namespace: string;
  podName: string;
  tailLines?: number | undefined;
}

export type KubeJobLogReporter = (line: string) => void | Promise<void>;

export interface KubeJobSpec {
  args?: string[] | undefined;
  cleanupPolicy?: 'delete' | 'ttl' | undefined;
  command?: string[] | undefined;
  emptyDirVolumes?: KubeJobEmptyDirVolume[] | undefined;
  env: Readonly<Record<string, string>>;
  id: string;
  image: string;
  imagePullSecretId?: string | undefined;
  initializers?: KubeJobInitializer[] | undefined;
  jobClass: 'build' | 'release' | 'operation';
  labels: Readonly<Record<string, string>>;
  namespace: string;
  onLogLine?: KubeJobLogReporter | undefined;
  priorityClassName?: string | undefined;
  resources?: object | undefined;
  scheduling?: KubeWorkloadScheduling | undefined;
  securityProfile?: 'project-restricted' | 'resource-restricted' | 'restricted' | undefined;
  serviceAccountName?: string | undefined;
  serviceAccountTokenExpirationSeconds?: number | undefined;
  sidecars?: KubeJobSidecar[] | undefined;
  timeoutMs: number;
  volumeMounts?: KubeJobVolumeMount[] | undefined;
}

export interface KubeJobInitializer {
  args?: string[] | undefined;
  command?: string[] | undefined;
  image: string;
  name: string;
  volumeMounts: KubeVolumeMount[];
}

export interface KubeJobEmptyDirVolume {
  containerMountPath?: string | undefined;
  name: string;
}

export interface KubeJobSidecar {
  args?: string[] | undefined;
  command?: string[] | undefined;
  env: Readonly<Record<string, string>>;
  image: string;
  name: string;
  resources?: object | undefined;
  securityProfile: 'userns-buildkit';
  volumeMounts: KubeVolumeMount[];
}

export interface KubeJobResult {
  completedAt: Date;
  exitCode: number | null;
  jobName: string;
  logs: string;
  podName: string | null;
  status: 'succeeded' | 'failed' | 'timed-out';
  finalize(): Promise<void>;
}

export interface KubePersistedJobResult {
  completedAt: Date;
  exitCode: number | null;
  jobName: string;
  logs: string;
  podName: string | null;
  status: 'succeeded' | 'failed' | 'timed-out';
}
