import { hasText } from '@compartment/utils';

interface BrowserAccessPageListPathInput<TSortBy extends string, TSortDirection extends string> {
  page: number;
  pageSize: number;
  searchQuery: string;
  sortBy: TSortBy;
  sortDirection: TSortDirection;
}

export function buildBrowserAccessPageListPath<TSortBy extends string, TSortDirection extends string>(
  pathname: string,
  query: Readonly<BrowserAccessPageListPathInput<TSortBy, TSortDirection>>,
): string {
  const searchParams: URLSearchParams = new URLSearchParams();
  searchParams.set('detail', 'list');
  searchParams.set('orderBy', query.sortBy);
  searchParams.set('page', String(query.page));
  searchParams.set('perPage', String(query.pageSize));
  searchParams.set('sort', query.sortDirection);
  if (hasText(query.searchQuery)) {
    searchParams.set('search', query.searchQuery);
  }

  return `${pathname}?${searchParams.toString()}`;
}
