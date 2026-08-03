import { z } from 'zod';
import type { ContractSchema } from './schema.types';

export type KubernetesPlatformWorkloadKind = 'DaemonSet' | 'Deployment';

export interface KubernetesPlatformWorkloadStatus {
  desiredReplicas: number;
  kind: KubernetesPlatformWorkloadKind;
  name: string;
  readyReplicas: number;
  ready: boolean;
}

export interface KubernetesSystemStatusResponse {
  ready: boolean;
  releaseName: string;
  releaseStatus: string;
  workloads: KubernetesPlatformWorkloadStatus[];
}

export interface KubernetesSystemRestartResponse {
  restarted: boolean;
  status: KubernetesSystemStatusResponse;
}

const kubernetesPlatformWorkloadStatusSchema: ContractSchema<KubernetesPlatformWorkloadStatus> = z
  .object({
    desiredReplicas: z.number().int().nonnegative(),
    kind: z.enum(['DaemonSet', 'Deployment']),
    name: z.string().min(1),
    readyReplicas: z.number().int().nonnegative(),
    ready: z.boolean(),
  })
  .strict();

export const kubernetesSystemStatusResponseSchema: ContractSchema<KubernetesSystemStatusResponse> = z
  .object({
    ready: z.boolean(),
    releaseName: z.string().min(1),
    releaseStatus: z.string().min(1),
    workloads: z.array(kubernetesPlatformWorkloadStatusSchema),
  })
  .strict();

export const kubernetesSystemRestartResponseSchema: ContractSchema<KubernetesSystemRestartResponse> = z
  .object({
    restarted: z.boolean(),
    status: kubernetesSystemStatusResponseSchema,
  })
  .strict();
