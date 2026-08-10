export interface ObservedContainerState {
  running?: object | undefined;
  terminated?: { exitCode: number; message?: string | undefined } | undefined;
  waiting?: { reason: string } | undefined;
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
