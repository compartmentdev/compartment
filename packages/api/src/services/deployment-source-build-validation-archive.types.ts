export type PendingSourceArchiveEntryCaptureKind =
  | 'global-pax-header'
  | 'local-pax-header'
  | 'long-path'
  | 'metadata'
  | 'none';

export type SourceArchiveTarEntryKind =
  | 'directory'
  | 'extended-header'
  | 'file'
  | 'global-extended-header'
  | 'long-link'
  | 'long-path';

export interface ReadSourceArchiveResult {
  logicalEntryPaths: string[];
  metadataFileContents: string;
}

export interface PendingSourceArchiveEntry {
  captureKind: PendingSourceArchiveEntryCaptureKind;
  capturedChunks: Buffer[];
  remainingContentBytes: number;
  remainingRecordBytes: number;
}

export interface PaxRecord {
  key: string;
  nextOffset: number;
  value: string;
}

export interface SourceArchiveReaderState {
  entryCount: number;
  logicalEntryPaths: Set<string>;
  metadataFileContents: string | null;
  nextPathOverride: string | null;
  pendingBuffer: Buffer;
  pendingEntry: PendingSourceArchiveEntry | null;
  sawArchiveEnd: boolean;
}

export interface SourceArchiveTarHeader {
  kind: SourceArchiveTarEntryKind;
  path: string;
  size: number;
}
