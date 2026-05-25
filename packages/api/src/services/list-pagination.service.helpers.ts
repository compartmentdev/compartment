import type { ListPagination } from '@compartment/contracts';

export type { ListPagination };

export interface ListPaginationResult<TItem> {
  items: TItem[];
  pagination: ListPagination;
}

export function paginateListItems<TItem>(items: TItem[], page: number, perPage: number): ListPaginationResult<TItem> {
  const totalItems: number = items.length;
  const totalPages: number = Math.max(1, Math.ceil(totalItems / perPage));
  const currentPage: number = Math.min(page, totalPages);
  const startIndex: number = (currentPage - 1) * perPage;

  return {
    items: items.slice(startIndex, startIndex + perPage),
    pagination: {
      page: currentPage,
      perPage,
      totalItems,
      totalPages,
    },
  };
}
