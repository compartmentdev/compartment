export interface TerminalJob {
  exitCode: number;
  /** Set when the Pod never reached its own container because an init container failed first. */
  initFailureMessage: string | null;
  podName: string;
  podNames: string[];
  succeeded: boolean;
}

export interface JobStatusCondition {
  status?: string | undefined;
  type?: string | undefined;
}

export interface JobStatus {
  conditions?: JobStatusCondition[] | undefined;
  failed?: number | undefined;
  succeeded?: number | undefined;
}

export interface PodInitFailure {
  exitCode: number;
  message: string;
}

export interface PodTerminatedState {
  exitCode?: number | undefined;
  message?: string | undefined;
}

export interface PodContainerState {
  terminated?: PodTerminatedState | undefined;
}

export interface PodContainerStatus {
  state?: PodContainerState | undefined;
}

export interface PodStatus {
  containerStatuses?: PodContainerStatus[] | undefined;
  initContainerStatuses?: PodContainerStatus[] | undefined;
}
