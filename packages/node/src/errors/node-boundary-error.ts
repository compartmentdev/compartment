export class NodeBoundaryError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  public constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'NodeBoundaryError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function isNodeBoundaryError(value: Error | null | undefined): value is NodeBoundaryError {
  return value instanceof NodeBoundaryError;
}
