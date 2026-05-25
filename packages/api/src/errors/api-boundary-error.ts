export class ApiBoundaryError extends Error {
  public readonly code: string;
  public readonly headers: Record<string, string>;
  public readonly statusCode: number;

  public constructor(statusCode: number, code: string, message: string, headers: Record<string, string> = {}) {
    super(message);
    this.name = 'ApiBoundaryError';
    this.code = code;
    this.headers = headers;
    this.statusCode = statusCode;
  }
}

export function isApiBoundaryError(value: Error | null | undefined): value is ApiBoundaryError {
  return value instanceof ApiBoundaryError;
}
