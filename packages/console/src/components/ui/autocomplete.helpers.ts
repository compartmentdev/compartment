import { type Dispatch, type MutableRefObject, type SetStateAction, useEffect, useMemo } from 'react';

interface AutocompleteFilterOption {
  label: string;
  searchText?: string | undefined;
  value: string;
}

export function useAutocompleteOutsideClose(
  containerRef: MutableRefObject<HTMLDivElement | null>,
  isOpen: boolean,
  setIsOpen: Dispatch<SetStateAction<boolean>>,
): void {
  useEffect((): (() => void) | void => {
    if (!isOpen) {
      return;
    }

    const handleDocumentMouseDown: (event: MouseEvent) => void = (event: MouseEvent): void => {
      const container: HTMLDivElement | null = containerRef.current;
      const target: Node | null = event.target instanceof Node ? event.target : null;
      if (container === null || target === null || container.contains(target)) {
        return;
      }

      setIsOpen(false);
    };

    document.addEventListener('mousedown', handleDocumentMouseDown);
    return (): void => document.removeEventListener('mousedown', handleDocumentMouseDown);
  }, [containerRef, isOpen, setIsOpen]);
}

export function useAutocompleteQueryReset(isOpen: boolean, setQuery: Dispatch<SetStateAction<string>>): void {
  useEffect((): void => {
    if (!isOpen) {
      setQuery('');
    }
  }, [isOpen, setQuery]);
}

export function useSelectedAutocompleteOptions<T extends { value: string }>(options: T[], values: string[]): T[] {
  return useMemo(
    (): T[] =>
      values.flatMap((value: string): T[] => {
        const option: T | undefined = options.find((candidate: T): boolean => candidate.value === value);
        return option === undefined ? [] : [option];
      }),
    [options, values],
  );
}

export function useFilteredAutocompleteOptions<T extends AutocompleteFilterOption>(options: T[], query: string): T[] {
  return useMemo(
    (): T[] => options.filter((option: T): boolean => matchesAutocompleteOption(option, query)),
    [options, query],
  );
}

function matchesAutocompleteOption(option: AutocompleteFilterOption, query: string): boolean {
  if (query.trim() === '') {
    return true;
  }

  const normalizedQuery: string = query.trim().toLowerCase();
  return [option.label, option.searchText ?? option.value].some((value: string): boolean =>
    value.toLowerCase().includes(normalizedQuery),
  );
}
