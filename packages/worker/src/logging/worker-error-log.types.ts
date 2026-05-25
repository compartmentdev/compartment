export type WorkerCaughtError = Error | object | string | number | boolean | bigint | symbol | null | undefined;

export interface WorkerIterationErrorLogPayload {
  err?: Error | undefined;
  errorMessage?: string | undefined;
}
