export interface ObservedTerminatedState {
  exitCode: number;
  message?: string | undefined;
}

export interface ObservedWaitingState {
  reason: string;
}

export interface ObservedContainerState {
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
