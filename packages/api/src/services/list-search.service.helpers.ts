import { hasText } from '@compartment/utils';

type ListSearchTextReader<TItem> = (item: TItem) => string;

export function filterListItemsBySearch<TItem>(
  items: TItem[],
  search: string | undefined,
  readSearchText: ListSearchTextReader<TItem>,
): TItem[] {
  if (!hasText(search)) {
    return items;
  }

  const normalizedSearch: string = normalizeSearchQuery(search);

  return items.filter((item: TItem): boolean =>
    normalizeSearchableText(readSearchText(item)).includes(normalizedSearch),
  );
}

function normalizeSearchQuery(search: string): string {
  return search.trim().toLowerCase();
}

function normalizeSearchableText(searchableText: string): string {
  return searchableText.toLowerCase();
}
