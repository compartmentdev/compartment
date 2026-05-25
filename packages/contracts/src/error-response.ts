import { errorResponseSchema, type ErrorResponse } from './contracts/error.contract';

export function createErrorResponse(code: string, message: string): ErrorResponse {
  return errorResponseSchema.parse({
    error: {
      code,
      message,
    },
  });
}
