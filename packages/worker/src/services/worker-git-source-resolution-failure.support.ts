class NonRetryableGitSourceTaskError extends Error {
  public readonly retryable: false = false;

  public constructor(message: string) {
    super(message);
    this.name = 'NonRetryableGitSourceTaskError';
  }
}

export class WorkerGitProviderHttpError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'WorkerGitProviderHttpError';
  }
}

export function createNonRetryableGitSourceTaskError(message: string): NonRetryableGitSourceTaskError {
  return new NonRetryableGitSourceTaskError(message);
}

export function isRetryableGitSourceTaskError(error: Error | undefined): boolean {
  if (error instanceof NonRetryableGitSourceTaskError) return false;
  const status: number | undefined = readHttpStatus(error);
  if (status === 401 || status === 403 || status === 404) return false;
  if (status === 429 || (status !== undefined && status >= 500)) return true;
  return true;
}

function readHttpStatus(error: Error | undefined): number | undefined {
  if (error instanceof WorkerGitProviderHttpError) return error.status;
  if (error !== undefined && 'status' in error && typeof error.status === 'number') return error.status;
  return undefined;
}
