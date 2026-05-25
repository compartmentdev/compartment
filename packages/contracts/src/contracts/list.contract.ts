import { z } from 'zod';
import type { ContractSchema } from './schema.types';

export type ListSortDirection = 'asc' | 'desc';

export interface ListPagination {
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
}

type ListNumberInputValue = number | string | undefined;

export const listPerPageLimit: number = 100;

export const listSortDirectionSchema: ContractSchema<ListSortDirection> = z.enum(['asc', 'desc']);

export const listPaginationSchema: ContractSchema<ListPagination> = z
  .object({
    page: z.number().int().positive(),
    perPage: z.number().int().positive(),
    totalItems: z.number().int().nonnegative(),
    totalPages: z.number().int().positive(),
  })
  .strict();

export const listPageQuerySchema: z.ZodType<number, z.ZodTypeDef, ListNumberInputValue> = z.coerce
  .number()
  .int()
  .positive();

export const listPerPageQuerySchema: z.ZodType<number, z.ZodTypeDef, ListNumberInputValue> = z.coerce
  .number()
  .int()
  .positive()
  .max(listPerPageLimit);
