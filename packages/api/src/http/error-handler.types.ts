export interface ApiErrorResponsePayload {
  code: string;
  headers?: Record<string, string> | undefined;
  message: string;
  statusCode: number;
}
