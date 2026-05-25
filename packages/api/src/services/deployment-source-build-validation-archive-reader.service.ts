import { createReadStream, type ReadStream } from 'node:fs';
import { createGunzip, type Gunzip } from 'node:zlib';
import {
  compartmentSourcePackageMetadataArchivePath,
  validateCompartmentSourcePackageArchiveEntryType,
} from '@compartment/contracts';
import type {
  PendingSourceArchiveEntry,
  PendingSourceArchiveEntryCaptureKind,
  ReadSourceArchiveResult,
  SourceArchiveReaderState,
  SourceArchiveTarHeader,
} from './deployment-source-build-validation-archive.types';
import {
  ensureZeroFilledBuffer,
  readLiteralArchiveEntryPath,
  readSourceArchiveTarHeader,
  readTarRecordByteLength,
  SourceUploadArchiveValidationError,
} from './deployment-source-build-validation-archive-tar.service';
import {
  cleanupSourceArchiveStreams,
  createSourceArchiveValidationTimeout,
  normalizeSourceArchiveReadError,
  pipeSourceArchiveStreams,
} from './deployment-source-build-validation-archive-reader-stream.service';
import { consumePendingSourceArchiveEntry as consumePendingSourceArchiveEntryChunk } from './deployment-source-build-validation-archive-pending.service';

const tarHeaderByteLength: number = 512;
const sourceArchiveValidationEntryLimit: number = 10_000;
const sourceArchiveValidationMetadataMaxBytes: number = 1_048_576;
const sourceArchiveValidationTransportHeaderMaxBytes: number = 1_024;
const sourceArchiveValidationTimeoutMs: number = 10_000;

export async function readSourceArchive(archivePath: string): Promise<ReadSourceArchiveResult> {
  const archiveStream: ReadStream = createReadStream(archivePath);
  const gunzipStream: Gunzip = createGunzip();
  const state: SourceArchiveReaderState = createSourceArchiveReaderState();
  const timeout: NodeJS.Timeout = createSourceArchiveValidationTimeout(
    archiveStream,
    gunzipStream,
    sourceArchiveValidationTimeoutMs,
  );

  pipeSourceArchiveStreams(archiveStream, gunzipStream);

  try {
    for await (const chunk of gunzipStream as AsyncIterable<Buffer>) {
      consumeSourceArchiveChunk(state, chunk);
    }

    return finalizeSourceArchiveRead(state);
  } catch (error) {
    throw normalizeSourceArchiveReadError(error instanceof Error ? error : undefined);
  } finally {
    cleanupSourceArchiveStreams(timeout, archiveStream, gunzipStream);
  }
}

function createSourceArchiveReaderState(): SourceArchiveReaderState {
  return {
    entryCount: 0,
    metadataFileContents: null,
    nextPathOverride: null,
    pendingBuffer: Buffer.alloc(0),
    pendingEntry: null,
    sawArchiveEnd: false,
  };
}

function consumeSourceArchiveChunk(state: SourceArchiveReaderState, chunk: Buffer): void {
  state.pendingBuffer = state.pendingBuffer.byteLength === 0 ? chunk : Buffer.concat([state.pendingBuffer, chunk]);

  while (state.pendingBuffer.byteLength > 0) {
    if (consumeSourceArchiveTrailingPadding(state) || consumePendingSourceArchiveEntryChunk(state)) {
      return;
    }
    if (state.pendingBuffer.byteLength < tarHeaderByteLength) {
      return;
    }

    consumeSourceArchiveHeaderBlock(state);
  }
}

function consumeSourceArchiveTrailingPadding(state: SourceArchiveReaderState): boolean {
  if (!state.sawArchiveEnd) {
    return false;
  }

  ensureZeroFilledBuffer(state.pendingBuffer);
  state.pendingBuffer = Buffer.alloc(0);
  return true;
}

function consumeSourceArchiveHeaderBlock(state: SourceArchiveReaderState): void {
  const headerBlock: Buffer = readSourceArchiveHeaderBlock(state);
  if (headerBlock.every((byte: number): boolean => byte === 0)) {
    state.sawArchiveEnd = true;
    return;
  }

  const header: SourceArchiveTarHeader = readSourceArchiveTarHeader(headerBlock);
  incrementSourceArchiveEntryCount(state);
  state.pendingEntry = createPendingSourceArchiveEntry(state, header);
}

function readSourceArchiveHeaderBlock(state: SourceArchiveReaderState): Buffer {
  const headerBlock: Buffer = state.pendingBuffer.subarray(0, tarHeaderByteLength);
  state.pendingBuffer = state.pendingBuffer.subarray(tarHeaderByteLength);
  return headerBlock;
}

function createPendingSourceArchiveEntry(
  state: SourceArchiveReaderState,
  header: SourceArchiveTarHeader,
): PendingSourceArchiveEntry | null {
  const captureKind: PendingSourceArchiveEntryCaptureKind = readPendingSourceArchiveEntryCaptureKind(state, header);
  validateSourceArchiveCaptureSize(captureKind, header.size);
  if (header.size === 0) {
    finalizeEmptyPendingSourceArchiveEntry(state, captureKind);
    return null;
  }

  return {
    captureKind,
    capturedChunks: [],
    remainingContentBytes: header.size,
    remainingRecordBytes: readTarRecordByteLength(header.size),
  };
}

function readPendingSourceArchiveEntryCaptureKind(
  state: SourceArchiveReaderState,
  header: SourceArchiveTarHeader,
): PendingSourceArchiveEntryCaptureKind {
  switch (header.kind) {
    case 'directory':
    case 'file':
      return readLogicalSourceArchiveEntryCaptureKind(state, header);
    case 'extended-header':
      return 'local-pax-header';
    case 'global-extended-header':
      return 'global-pax-header';
    case 'long-link':
      throw new SourceUploadArchiveValidationError('Uploaded source archive contains unsupported entry type byte "K".');
    case 'long-path':
      return 'long-path';
  }
}

function readLogicalSourceArchiveEntryCaptureKind(
  state: SourceArchiveReaderState,
  header: SourceArchiveTarHeader,
): PendingSourceArchiveEntryCaptureKind {
  const entryKind: 'directory' | 'file' = header.kind === 'directory' ? 'directory' : 'file';
  const entryPath: string = readLogicalSourceArchiveEntryPath(state, header.path);
  validateSourceArchiveLogicalEntryType(entryPath, entryKind);
  if (entryKind !== 'file' || entryPath !== compartmentSourcePackageMetadataArchivePath) {
    return 'none';
  }
  if (state.metadataFileContents !== null) {
    throw new SourceUploadArchiveValidationError(
      `Uploaded source archive contains duplicate "${compartmentSourcePackageMetadataArchivePath}" entries.`,
    );
  }
  if (header.size > sourceArchiveValidationMetadataMaxBytes) {
    throw new SourceUploadArchiveValidationError(
      `Uploaded source archive metadata must not exceed ${sourceArchiveValidationMetadataMaxBytes} bytes.`,
    );
  }

  return 'metadata';
}

function incrementSourceArchiveEntryCount(state: SourceArchiveReaderState): void {
  state.entryCount += 1;
  if (state.entryCount <= sourceArchiveValidationEntryLimit) {
    return;
  }

  throw new SourceUploadArchiveValidationError(
    `Uploaded source archive must not contain more than ${sourceArchiveValidationEntryLimit} entries.`,
  );
}

function readLogicalSourceArchiveEntryPath(state: SourceArchiveReaderState, rawPath: string): string {
  const entryPath: string = readLiteralArchiveEntryPath(state.nextPathOverride ?? rawPath);
  state.nextPathOverride = null;
  return entryPath;
}

function validateSourceArchiveLogicalEntryType(entryPath: string, entryKind: 'directory' | 'file'): void {
  try {
    validateCompartmentSourcePackageArchiveEntryType(entryPath, entryKind === 'directory' ? 'd' : '-');
  } catch (error) {
    throw new SourceUploadArchiveValidationError(
      error instanceof Error ? error.message : 'The uploaded source archive is invalid.',
    );
  }
}

function validateSourceArchiveCaptureSize(captureKind: PendingSourceArchiveEntryCaptureKind, size: number): void {
  const maxCapturedBytes: number | null = readSourceArchiveCaptureByteLimit(captureKind);
  if (maxCapturedBytes === null || size <= maxCapturedBytes) {
    return;
  }

  throw new SourceUploadArchiveValidationError(
    `Uploaded source archive transport headers must not exceed ${maxCapturedBytes} bytes.`,
  );
}

function readSourceArchiveCaptureByteLimit(captureKind: PendingSourceArchiveEntryCaptureKind): number | null {
  switch (captureKind) {
    case 'global-pax-header':
    case 'local-pax-header':
    case 'long-path':
      return sourceArchiveValidationTransportHeaderMaxBytes;
    case 'metadata':
      return sourceArchiveValidationMetadataMaxBytes;
    case 'none':
      return null;
  }
}

function finalizeEmptyPendingSourceArchiveEntry(
  state: SourceArchiveReaderState,
  captureKind: PendingSourceArchiveEntryCaptureKind,
): void {
  switch (captureKind) {
    case 'global-pax-header':
      return;
    case 'local-pax-header':
      state.nextPathOverride = null;
      return;
    case 'long-path':
      throw new SourceUploadArchiveValidationError('Uploaded source archive contains an invalid GNU long path header.');
    case 'metadata':
      state.metadataFileContents = '';
      return;
    case 'none':
      return;
  }
}

function finalizeSourceArchiveRead(state: SourceArchiveReaderState): ReadSourceArchiveResult {
  if (isSourceArchiveReadIncomplete(state)) {
    throw new SourceUploadArchiveValidationError('Uploaded source archive must be a valid gzip-compressed tarball.');
  }
  if (state.metadataFileContents === null) {
    throw new SourceUploadArchiveValidationError('Uploaded source archive must contain source-package metadata.');
  }

  return {
    metadataFileContents: state.metadataFileContents,
  };
}

function isSourceArchiveReadIncomplete(state: SourceArchiveReaderState): boolean {
  return (
    state.pendingEntry !== null ||
    state.pendingBuffer.byteLength > 0 ||
    state.nextPathOverride !== null ||
    !state.sawArchiveEnd
  );
}
