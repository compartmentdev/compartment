import type {
  ProductJobClass,
  ProductJobIntent,
  ProductJobStatus,
  ProductJobVolumeMount,
  WorkerPersistProductJobResultRequest,
} from '@compartment/contracts';

export interface ProductJobRunRow {
  commandJson: string;
  completedAt: Date | null;
  createdAt: Date;
  envJson: string;
  exitCode: number | null;
  id: string;
  identityId: string;
  image: string;
  imagePullSecretId: string | null;
  jobClass: ProductJobClass;
  jobName: string | null;
  logs: string | null;
  namespace: string;
  podName: string | null;
  projectId: string;
  resourceIdsJson: string;
  status: ProductJobStatus;
  timeoutMs: number;
  updatedAt: Date;
  volumeMountsJson: string;
}

export type ProductJobResultRow = Pick<
  ProductJobRunRow,
  'completedAt' | 'exitCode' | 'identityId' | 'jobClass' | 'jobName' | 'logs' | 'podName' | 'status'
>;

export interface PersistProductJobIntentInput {
  identityId: string;
  intent: ProductJobIntent;
}

export interface ProductJobCommonSpec {
  command: string[];
  env: Record<string, string>;
  image: string;
  imagePullSecretId?: string | undefined;
  namespace: string;
  projectId: string;
  timeoutMs: number;
  volumeMounts?: ProductJobVolumeMount[] | undefined;
}

export type PersistProductJobResultInput = WorkerPersistProductJobResultRequest;

export interface ClaimedProductJobQueryResult {
  intent: ProductJobIntent | null;
  persistedResult: WorkerPersistProductJobResultRequest | null;
}

export type ProductJobResourceFenceResult = 'blocked' | 'claimable' | 'terminalized';
