import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { isMissingFileSystemEntryError } from '@compartment/utils';

export async function hasDirectoryFile(directory: string, fileName: string): Promise<boolean> {
  try {
    return (await stat(join(directory, fileName))).isFile();
  } catch (error) {
    if (error instanceof Error && isMissingFileSystemEntryError(error)) {
      return false;
    }

    throw error;
  }
}
