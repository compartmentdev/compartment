export type FetchInput = string | Request | URL;

export interface FetchCall {
  init: RequestInit | undefined;
  input: FetchInput;
}

export interface FetchMockState {
  calls: FetchCall[];
}
