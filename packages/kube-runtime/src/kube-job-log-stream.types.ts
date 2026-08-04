import type { Writable } from 'node:stream';
import type { KubeJobLogChunkHandler, KubeJobLogErrorHandler } from './kube-job-spec.types';

export type { KubeJobLogChunkHandler, KubeJobLogErrorHandler };

export interface LogOutput {
  finished: Promise<Error | null>;
  stream: Writable;
}

export interface ActiveLogOutput extends LogOutput {
  controller: AbortController;
}

export interface JobLogStream {
  finished: Promise<void>;
  stopUnattachedRetries: () => void;
}

export interface JobStatus {
  conditions?: JobStatusCondition[] | undefined;
  failed?: number | undefined;
  succeeded?: number | undefined;
}

export interface JobStatusCondition {
  status?: string | undefined;
  type?: string | undefined;
}

export interface JobContainerStatus {
  name?: string | undefined;
  state?: JobContainerState | undefined;
}

export interface JobContainerState {
  running?: object | undefined;
  terminated?: object | undefined;
}

export interface PodStatus {
  containerStatuses?: JobContainerStatus[] | undefined;
}
