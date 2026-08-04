import type { Writable } from 'node:stream';

export interface LogOutput {
  finished: Promise<Error | null>;
  stream: Writable;
}

export interface ActiveLogOutput extends LogOutput {
  controller: AbortController;
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
  state?: { running?: object | undefined; terminated?: object | undefined } | undefined;
}

export interface PodStatus {
  containerStatuses?: JobContainerStatus[] | undefined;
}
