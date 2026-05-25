export interface AuthThrottleTrackedOperation<TResult> {
  clearSuccess: () => Promise<void>;
  clearSuccessFailureMessage: string;
  isCountedFailure: (error: Error) => boolean;
  recordCountedFailure: () => Promise<void>;
  recordCountedFailureMessage: string;
  run: () => Promise<TResult>;
}
