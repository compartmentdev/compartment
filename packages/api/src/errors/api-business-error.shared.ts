import { businessErrorDefinitions } from './api-business-error.definitions';
import type { ApiBusinessErrorCode, ApiBusinessErrorDefinition, ApiMappedError } from './api-business-error.types';

export class ApiBusinessError extends Error {
  public readonly code: ApiBusinessErrorCode;

  public constructor(code: ApiBusinessErrorCode, message?: string, options?: ErrorOptions) {
    super(message ?? businessErrorDefinitions[code].message, options);
    this.name = 'ApiBusinessError';
    this.code = code;
  }
}

export function mapApiBusinessError(error: ApiBusinessError): ApiMappedError {
  const definition: ApiBusinessErrorDefinition = businessErrorDefinitions[error.code];

  return {
    code: error.code,
    message: error.message,
    statusCode: definition.statusCode,
  };
}

export function isApiBusinessError(value: Error | null | undefined): value is ApiBusinessError {
  return value instanceof ApiBusinessError;
}
