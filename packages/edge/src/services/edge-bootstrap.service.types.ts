export interface EdgeBootstrapFetchError extends Error {
  cause?: {
    code?: string | undefined;
  };
}
