import type { SafeParseReturnType, ZodType, ZodTypeDef } from 'zod';
import { NodeBoundaryError } from '../../errors/node-boundary-error';

export const invalidNodeInternalRequestMessage: string = 'The node internal request is invalid.';

export function parseNodeInternalRequestValue<TValue, TInput>(
  schema: ZodType<TValue, ZodTypeDef, TInput>,
  value: TInput,
  code: string,
): TValue {
  const parsed: SafeParseReturnType<TInput, TValue> = schema.safeParse(value);

  if (!parsed.success) {
    throw new NodeBoundaryError(400, code, invalidNodeInternalRequestMessage);
  }

  return parsed.data;
}
