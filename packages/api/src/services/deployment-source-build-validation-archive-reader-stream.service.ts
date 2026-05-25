import type { ReadStream } from 'node:fs';
import type { Gunzip } from 'node:zlib';
import { SourceUploadArchiveValidationError } from './deployment-source-build-validation-archive-tar.service';

export function createSourceArchiveValidationTimeout(
  archiveStream: ReadStream,
  gunzipStream: Gunzip,
  timeoutMs: number,
): NodeJS.Timeout {
  return setTimeout((): void => {
    const error: SourceUploadArchiveValidationError = new SourceUploadArchiveValidationError(
      `Uploaded source archive validation exceeded ${timeoutMs} ms.`,
    );
    archiveStream.destroy(error);
    gunzipStream.destroy(error);
  }, timeoutMs);
}

export function pipeSourceArchiveStreams(archiveStream: ReadStream, gunzipStream: Gunzip): void {
  archiveStream.pipe(gunzipStream);
}

export function cleanupSourceArchiveStreams(
  timeout: NodeJS.Timeout,
  archiveStream: ReadStream,
  gunzipStream: Gunzip,
): void {
  clearTimeout(timeout);
  archiveStream.destroy();
  gunzipStream.destroy();
}

export function normalizeSourceArchiveReadError(error: Error | undefined): Error {
  if (error instanceof SourceUploadArchiveValidationError) {
    return error;
  }
  if (error !== undefined && isZlibArchiveError(error)) {
    return new SourceUploadArchiveValidationError('Uploaded source archive must be a valid gzip-compressed tarball.');
  }

  return error ?? new Error('Failed to read uploaded source archive.');
}

function isZlibArchiveError(error: Error): error is NodeJS.ErrnoException {
  const code: string | undefined = (error as NodeJS.ErrnoException).code;
  return code === 'Z_BUF_ERROR' || code === 'Z_DATA_ERROR';
}
