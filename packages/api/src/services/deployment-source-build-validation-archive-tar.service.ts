import { readCompartmentSourcePackageLiteralArchiveEntryPath } from '@compartment/contracts';
import type {
  PaxRecord,
  SourceArchiveTarEntryKind,
  SourceArchiveTarHeader,
} from './deployment-source-build-validation-archive.types';

const paxRecordSeparatorByte: number = 32;
const tarBlockByteLength: number = 512;

export class SourceUploadArchiveValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'SourceUploadArchiveValidationError';
  }
}

export function readSourceArchiveTarHeader(headerBlock: Buffer): SourceArchiveTarHeader {
  validateTarHeaderChecksum(headerBlock);

  return {
    kind: readTarEntryKind(headerBlock[156] ?? 0),
    path: readTarArchivePath(headerBlock),
    size: readTarEntrySize(headerBlock),
  };
}

export function readPaxPathOverride(archiveContents: Buffer): string | null {
  let pathOverride: string | null = null;
  let offset: number = 0;

  while (offset < archiveContents.byteLength) {
    const record: PaxRecord = readPaxRecord(archiveContents, offset);
    if (record.key === 'path') {
      pathOverride = readLiteralArchiveEntryPath(record.value);
    }
    offset = record.nextOffset;
  }

  return pathOverride;
}

export function readTarRecordByteLength(size: number): number {
  return Math.ceil(size / tarBlockByteLength) * tarBlockByteLength;
}

export function readLongPathOverride(archiveContents: Buffer): string {
  const nulByteIndex: number = archiveContents.indexOf(0);
  const pathBuffer: Buffer = archiveContents.subarray(0, nulByteIndex === -1 ? undefined : nulByteIndex);

  return readLiteralArchiveEntryPath(pathBuffer.toString('utf8'));
}

export function readLiteralArchiveEntryPath(entryPath: string): string {
  try {
    return readCompartmentSourcePackageLiteralArchiveEntryPath(entryPath);
  } catch (error) {
    throw new SourceUploadArchiveValidationError(
      error instanceof Error ? error.message : 'The uploaded source archive is invalid.',
    );
  }
}

export function ensureZeroFilledBuffer(buffer: Buffer): void {
  if (buffer.every((byte: number): boolean => byte === 0)) {
    return;
  }

  throw new SourceUploadArchiveValidationError('Uploaded source archive must be a valid gzip-compressed tarball.');
}

function validateTarHeaderChecksum(headerBlock: Buffer): void {
  const expectedChecksum: number = readTarOctalNumber(headerBlock, 148, 8, 'checksum');
  let actualChecksum: number = 0;

  for (let index: number = 0; index < tarBlockByteLength; index += 1) {
    actualChecksum += index >= 148 && index < 156 ? 32 : (headerBlock[index] ?? 0);
  }
  if (actualChecksum !== expectedChecksum) {
    throw new SourceUploadArchiveValidationError('Uploaded source archive must be a valid gzip-compressed tarball.');
  }
}

function readPaxRecord(archiveContents: Buffer, offset: number): PaxRecord {
  const separatorIndex: number = archiveContents.indexOf(paxRecordSeparatorByte, offset);
  if (separatorIndex === -1) {
    throw new SourceUploadArchiveValidationError('Uploaded source archive contains an invalid PAX header.');
  }

  const recordByteLength: number = readPaxRecordByteLength(archiveContents, offset, separatorIndex);
  const recordEnd: number = offset + recordByteLength;
  validatePaxRecordBounds(archiveContents, recordByteLength, recordEnd);
  const recordText: string = readPaxRecordText(archiveContents, separatorIndex, recordEnd);
  const equalsIndex: number = recordText.indexOf('=');
  if (equalsIndex === -1) {
    throw new SourceUploadArchiveValidationError('Uploaded source archive contains an invalid PAX header.');
  }

  return {
    key: recordText.slice(0, equalsIndex),
    nextOffset: recordEnd,
    value: recordText.slice(equalsIndex + 1),
  };
}

function readPaxRecordByteLength(archiveContents: Buffer, offset: number, separatorIndex: number): number {
  const recordByteLengthText: string = archiveContents.subarray(offset, separatorIndex).toString('ascii');
  if (!/^\d+$/u.test(recordByteLengthText)) {
    throw new SourceUploadArchiveValidationError('Uploaded source archive contains an invalid PAX header.');
  }

  return Number.parseInt(recordByteLengthText, 10);
}

function validatePaxRecordBounds(archiveContents: Buffer, recordByteLength: number, recordEnd: number): void {
  if (!Number.isSafeInteger(recordByteLength) || recordByteLength <= 0 || recordEnd > archiveContents.byteLength) {
    throw new SourceUploadArchiveValidationError('Uploaded source archive contains an invalid PAX header.');
  }
  if ((archiveContents[recordEnd - 1] ?? 0) !== 10) {
    throw new SourceUploadArchiveValidationError('Uploaded source archive contains an invalid PAX header.');
  }
}

function readPaxRecordText(archiveContents: Buffer, separatorIndex: number, recordEnd: number): string {
  return archiveContents.subarray(separatorIndex + 1, recordEnd - 1).toString('utf8');
}

function readTarArchivePath(headerBlock: Buffer): string {
  const name: string = readTarString(headerBlock, 0, 100);
  const prefix: string = readTarString(headerBlock, 345, 155);
  const rawPath: string = prefix === '' ? name : `${prefix}/${name}`;
  if (rawPath === '') {
    throw new SourceUploadArchiveValidationError('Uploaded source archive contains an entry with an empty path.');
  }

  return rawPath;
}

function readTarEntrySize(headerBlock: Buffer): number {
  return readTarOctalNumber(headerBlock, 124, 12, 'size');
}

function readTarEntryKind(typeByte: number): SourceArchiveTarEntryKind {
  switch (typeByte) {
    case 0:
    case 48:
      return 'file';
    case 53:
      return 'directory';
    case 75:
      return 'long-link';
    case 76:
      return 'long-path';
    case 103:
      return 'global-extended-header';
    case 120:
      return 'extended-header';
    default:
      throw new SourceUploadArchiveValidationError(
        `Uploaded source archive contains unsupported entry type byte "${String.fromCharCode(typeByte)}".`,
      );
  }
}

function readTarOctalNumber(headerBlock: Buffer, offset: number, length: number, label: string): number {
  const numericFieldBuffer: Buffer = headerBlock.subarray(offset, offset + length);
  if ((numericFieldBuffer[0] ?? 0) >= 128) {
    throw new SourceUploadArchiveValidationError(
      `Uploaded source archive contains an unsupported ${label} field format.`,
    );
  }

  const numericText: string = readTarString(headerBlock, offset, length).trim();
  if (numericText === '') {
    return 0;
  }
  if (!/^[0-7]+$/u.test(numericText)) {
    throw new SourceUploadArchiveValidationError(`Uploaded source archive contains an invalid ${label} field.`);
  }

  return Number.parseInt(numericText, 8);
}

function readTarString(headerBlock: Buffer, offset: number, length: number): string {
  const fieldBuffer: Buffer = headerBlock.subarray(offset, offset + length);
  const nulByteIndex: number = fieldBuffer.indexOf(0);
  const fieldEndIndex: number = nulByteIndex === -1 ? fieldBuffer.byteLength : nulByteIndex;

  return fieldBuffer.subarray(0, fieldEndIndex).toString('utf8');
}
