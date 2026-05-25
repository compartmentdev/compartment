import type {
  PendingSourceArchiveEntry,
  SourceArchiveReaderState,
} from './deployment-source-build-validation-archive.types';
import {
  readLongPathOverride,
  readPaxPathOverride,
  SourceUploadArchiveValidationError,
} from './deployment-source-build-validation-archive-tar.service';

export function consumePendingSourceArchiveEntry(state: SourceArchiveReaderState): boolean {
  const pendingEntry: PendingSourceArchiveEntry | null = state.pendingEntry;
  if (pendingEntry === null) {
    return false;
  }

  const consumedRecordBytes: number = Math.min(state.pendingBuffer.byteLength, pendingEntry.remainingRecordBytes);
  recordPendingSourceArchiveChunk(state, pendingEntry, consumedRecordBytes);
  advancePendingSourceArchiveEntry(state, pendingEntry, consumedRecordBytes);
  if (pendingEntry.remainingRecordBytes > 0) {
    return true;
  }

  finalizePendingSourceArchiveEntry(state, pendingEntry);
  state.pendingEntry = null;
  return false;
}

function recordPendingSourceArchiveChunk(
  state: SourceArchiveReaderState,
  pendingEntry: PendingSourceArchiveEntry,
  consumedRecordBytes: number,
): void {
  if (pendingEntry.captureKind === 'none' || pendingEntry.remainingContentBytes === 0) {
    return;
  }

  const capturedByteLength: number = Math.min(consumedRecordBytes, pendingEntry.remainingContentBytes);
  pendingEntry.capturedChunks.push(state.pendingBuffer.subarray(0, capturedByteLength));
}

function advancePendingSourceArchiveEntry(
  state: SourceArchiveReaderState,
  pendingEntry: PendingSourceArchiveEntry,
  consumedRecordBytes: number,
): void {
  state.pendingBuffer = state.pendingBuffer.subarray(consumedRecordBytes);
  pendingEntry.remainingContentBytes = Math.max(0, pendingEntry.remainingContentBytes - consumedRecordBytes);
  pendingEntry.remainingRecordBytes -= consumedRecordBytes;
}

function finalizePendingSourceArchiveEntry(
  state: SourceArchiveReaderState,
  pendingEntry: PendingSourceArchiveEntry,
): void {
  const capturedContents: Buffer = Buffer.concat(pendingEntry.capturedChunks);

  switch (pendingEntry.captureKind) {
    case 'global-pax-header':
      validateGlobalPaxPathOverride(readPaxPathOverride(capturedContents));
      return;
    case 'local-pax-header':
      state.nextPathOverride = readPaxPathOverride(capturedContents);
      return;
    case 'long-path':
      state.nextPathOverride = readLongPathOverride(capturedContents);
      return;
    case 'metadata':
      state.metadataFileContents = capturedContents.toString('utf8');
      return;
    case 'none':
      return;
  }
}

function validateGlobalPaxPathOverride(pathOverride: string | null): void {
  if (pathOverride === null) {
    return;
  }

  throw new SourceUploadArchiveValidationError(
    'Uploaded source archive contains unsupported global PAX path overrides.',
  );
}
