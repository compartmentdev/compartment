class NonRetryableGitSourceTaskError extends Error {
  public readonly retryable: false = false;

  public constructor(message: string) {
    super(message);
    this.name = 'NonRetryableGitSourceTaskError';
  }
}

export function createNonRetryableGitSourceTaskError(message: string): NonRetryableGitSourceTaskError {
  return new NonRetryableGitSourceTaskError(message);
}

export function isRetryableGitSourceTaskError(error: Error | undefined): boolean {
  return !(error instanceof NonRetryableGitSourceTaskError);
}
