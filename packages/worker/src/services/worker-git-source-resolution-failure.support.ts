class NonRetryableGitSourceResolutionError extends Error {
  public readonly retryable: false = false;

  public constructor(message: string) {
    super(message);
    this.name = 'NonRetryableGitSourceResolutionError';
  }
}

export function createNonRetryableGitSourceResolutionError(message: string): NonRetryableGitSourceResolutionError {
  return new NonRetryableGitSourceResolutionError(message);
}

export function isRetryableGitSourceResolutionFailure(error: Error | undefined): boolean {
  return !(error instanceof NonRetryableGitSourceResolutionError);
}
