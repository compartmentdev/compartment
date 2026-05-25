export interface EdgeRequestError extends Error {
  statusCode?: number | undefined;
}
