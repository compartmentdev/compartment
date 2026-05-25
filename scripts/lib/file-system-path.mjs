export function isMissingFileSystemEntryError(error) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
