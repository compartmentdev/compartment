import { listPerPageLimit, type ListPagination } from '@compartment/contracts';
import type { Command } from 'commander';

export interface ResolvedListCommandPagination {
  page: number;
  perPage: number;
}

interface ListCommandPaginationOptions {
  page?: string | undefined;
  perPage?: string | undefined;
}

interface PositiveIntegerOptionConstraints {
  errorMessage?: string | undefined;
  max?: number | undefined;
}

interface PaginationHintInput {
  itemName: string;
  pagination: ListPagination;
}

const defaultListPage: number = 1;
const defaultListPerPage: number = listPerPageLimit;

export function addListPaginationOptions(command: Command): Command {
  return command
    .option('--page <number>', 'list page to fetch', String(defaultListPage))
    .option('--per-page <number>', `items per page, up to ${listPerPageLimit}`, String(defaultListPerPage));
}

export function readListCommandPagination(options: ListCommandPaginationOptions): ResolvedListCommandPagination {
  return {
    page: readPositiveIntegerOption(options.page, '--page', defaultListPage),
    perPage: readPositiveIntegerOption(options.perPage, '--per-page', defaultListPerPage, { max: listPerPageLimit }),
  };
}

export function createPaginationHint(input: PaginationHintInput): string | null {
  if (input.pagination.page >= input.pagination.totalPages) {
    return null;
  }

  const startItem: number = (input.pagination.page - 1) * input.pagination.perPage + 1;
  const endItem: number = Math.min(input.pagination.page * input.pagination.perPage, input.pagination.totalItems);

  return `Showing ${input.itemName} ${startItem}-${endItem} of ${input.pagination.totalItems}. Use --page ${
    input.pagination.page + 1
  } to view more.`;
}

function readPositiveIntegerOption(
  value: string | undefined,
  optionName: string,
  fallback: number,
  constraints: PositiveIntegerOptionConstraints = {},
): number {
  const parsedValue: number | undefined = readOptionalPositiveIntegerOption(value, optionName, constraints);
  return parsedValue ?? fallback;
}

export function readOptionalPositiveIntegerOption(
  value: string | undefined,
  optionName: string,
  constraints: PositiveIntegerOptionConstraints = {},
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(constraints.errorMessage ?? `${optionName} must be a positive integer.`);
  }

  const parsedValue: number = Number.parseInt(value, 10);
  if (constraints.max !== undefined && parsedValue > constraints.max) {
    throw new Error(constraints.errorMessage ?? `${optionName} must be less than or equal to ${constraints.max}.`);
  }

  return parsedValue;
}
