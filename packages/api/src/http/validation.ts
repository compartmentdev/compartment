import type { SafeParseReturnType, ZodType, ZodTypeDef } from 'zod';
import { ApiBoundaryError } from '../errors/api-boundary-error';

export function parseRequestValue<TValue, TInput>(
  schema: ZodType<TValue, ZodTypeDef, TInput>,
  value: TInput,
  code: string,
  message?: string,
): TValue {
  const parsed: SafeParseReturnType<TInput, TValue> = schema.safeParse(value);

  if (!parsed.success) {
    throw new ApiBoundaryError(400, code, message ?? parsed.error.message);
  }

  return parsed.data;
}
