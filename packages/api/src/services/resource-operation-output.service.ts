import type { ResourceOperationOutputError } from './resources.service.types';

const maxOperationOutputSummaryLength: number = 16_384;

export function readOperationErrorOutput(error: Error, key: 'stderr' | 'stdout'): string {
  return summarizeOperationOutput(readOperationOutputValue(error, key));
}

export function summarizeOperationOutput(output: string): string {
  return output.length <= maxOperationOutputSummaryLength ? output : output.slice(-maxOperationOutputSummaryLength);
}

function readOperationOutputValue(error: Error, key: 'stderr' | 'stdout'): string {
  const outputError: ResourceOperationOutputError = error;

  return outputError[key] ?? '';
}
