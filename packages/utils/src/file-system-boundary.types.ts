export type FileSystemEntryKind = 'any' | 'directory' | 'file';

export interface ValidateFileSystemEntryInput {
  absolutePath: string;
  authoredPath: string;
  boundaryDirectory: string;
  boundaryLabel: string;
  expectedKind: FileSystemEntryKind;
  label: string;
  missingMessage?: string | undefined;
  relativeToLabel?: string | undefined;
}

export interface ValidateFileSystemWriteTargetInput {
  absolutePath: string;
  authoredPath: string;
  boundaryDirectory: string;
  boundaryLabel: string;
  expectedKind?: FileSystemEntryKind | undefined;
  label: string;
  relativeToLabel?: string | undefined;
}

export interface ValidatedFileSystemEntry {
  absolutePath: string;
  realPath: string;
}

export interface ValidatedFileSystemWriteTarget {
  absolutePath: string;
  boundaryRealPath: string;
  exists: boolean;
}
