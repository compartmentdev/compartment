import type {
  ProductJobClass,
  ProductJobIntent,
  ProductJobStatus,
  WorkerPersistProductJobResultRequest,
} from '@compartment/contracts';

export interface ProductJobRunRow {
  commandJson: string;
  completedAt: Date | null;
  createdAt: Date;
  envJson: string;
  exitCode: number | null;
  identityId: string;
  image: string;
  jobClass: ProductJobClass;
  jobName: string | null;
  logs: string | null;
  namespace: string;
  podName: string | null;
  status: ProductJobStatus;
  timeoutMs: number;
}

export interface PersistProductJobIntentInput {
  identityId: string;
  intent: ProductJobIntent;
}

export interface ProductJobCommonSpec {
  command: string[];
  env: Record<string, string>;
  image: string;
  namespace: string;
  timeoutMs: number;
}

export type PersistProductJobResultInput = WorkerPersistProductJobResultRequest;

export interface ClaimedProductJobQueryResult {
  intent: ProductJobIntent | null;
  persistedResult: WorkerPersistProductJobResultRequest | null;
}
