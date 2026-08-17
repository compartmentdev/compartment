export interface BuildSourceArchiveFetchInput {
  apiUrl: string;
  artifactId: string;
  onRetry: (diagnostic: BuildSourceArchiveFetchRetryDiagnostic) => void;
  sourceArchiveCredential: string;
}

export interface BuildSourceArchiveFetchRetryDiagnostic {
  attempt: number;
  delayMs: number;
  diagnostic: string;
  maximumAttempts: number;
  target: string;
}

export interface BuildSourceArchiveFetchRetryInput {
  attempt: number;
  failure: Error;
  fetchInput: BuildSourceArchiveFetchInput;
  remainingTimeoutMs: number;
  target: string;
}
