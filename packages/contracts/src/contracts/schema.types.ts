import type { ZodType, ZodTypeDef } from 'zod';

export type ContractSchema<TValue, TInput = TValue> = ZodType<TValue, ZodTypeDef, TInput>;
