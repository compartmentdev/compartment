import type { ListPagination } from '@compartment/contracts';

interface BuildListPaginationInput {
  page: number;
  perPage: number;
  totalItems: number;
}

export function buildListPagination(input: Readonly<BuildListPaginationInput>): ListPagination {
  const totalPages: number = Math.max(1, Math.ceil(input.totalItems / input.perPage));

  return {
    page: Math.min(input.page, totalPages),
    perPage: input.perPage,
    totalItems: input.totalItems,
    totalPages,
  };
}
