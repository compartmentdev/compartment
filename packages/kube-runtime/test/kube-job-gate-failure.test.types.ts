export interface ObservedTerminatedState {
  exitCode: number;
  message?: string | undefined;
}

export interface ObservedWaitingState {
  reason: string;
}

/** A container Kubernetes reports as running carries a start time and nothing this suite reads. */
export interface ObservedRunningState {
  startedAt?: string | undefined;
}

export interface ObservedContainerState {
  running?: ObservedRunningState | undefined;
  terminated?: ObservedTerminatedState | undefined;
  waiting?: ObservedWaitingState | undefined;
}

export interface ObservedContainerStatus {
  name: string;
  state: ObservedContainerState;
}

/** The slice of Pod status the terminal-Job classification reads. */
export interface ObservedPodStatus {
  containerStatuses: ObservedContainerStatus[];
  initContainerStatuses?: ObservedContainerStatus[] | undefined;
}

/** The core API surface this suite's Job never reaches, because its own container never starts. */
export interface StubCoreApi {
  readNamespacedPodLog?: undefined;
}
