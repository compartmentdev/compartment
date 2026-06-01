import type { Stats } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { isMissingFileSystemEntryError } from '@compartment/utils';

export async function readOptionalSelfHostedPathStats(path: string): Promise<Stats | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if (error instanceof Error && isMissingFileSystemEntryError(error)) {
      return null;
    }
    throw error;
  }
}
