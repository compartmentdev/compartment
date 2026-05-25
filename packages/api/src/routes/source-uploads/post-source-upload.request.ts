import type { Multipart, MultipartFile } from '@fastify/multipart';
import { sourceUploadArchiveMultipartFieldName } from '@compartment/contracts';
import type { FastifyRequest } from 'fastify';
import { ApiBoundaryError } from '../../errors/api-boundary-error';
import { getApiConfig } from '../../runtime/runtime-access';

export const invalidSourceUploadRequestCode: string = 'invalid_source_upload_request';

type SourceUploadPartHandler<T> = (sourceArchive: MultipartFile) => Promise<T>;

export async function parsePostSourceUploadRequest<T>(
  request: FastifyRequest,
  onSourceArchive: SourceUploadPartHandler<T>,
): Promise<T> {
  if (!request.isMultipart()) {
    throw new ApiBoundaryError(400, invalidSourceUploadRequestCode, 'Expected multipart/form-data request body.');
  }

  let sourceUpload: T | undefined;
  for await (const part of request.parts(readSourceUploadMultipartOptions())) {
    sourceUpload = await parseSourceUploadMultipartPart(part, sourceUpload, onSourceArchive);
  }

  return requireSourceUpload(sourceUpload);
}

function readSourceUploadMultipartOptions(): {
  limits: {
    fields: number;
    files: number;
    fileSize: number;
    parts: number;
  };
} {
  return {
    limits: {
      fields: 1,
      files: 1,
      fileSize: getApiConfig().sourceArchiveMaxBytes,
      parts: 2,
    },
  };
}

async function parseSourceUploadMultipartPart<T>(
  part: Multipart,
  sourceUpload: T | undefined,
  onSourceArchive: SourceUploadPartHandler<T>,
): Promise<T> {
  if (
    !isMultipartFilePart(part) ||
    part.fieldname !== sourceUploadArchiveMultipartFieldName ||
    sourceUpload !== undefined
  ) {
    throw new ApiBoundaryError(400, invalidSourceUploadRequestCode, `Unexpected field ${part.fieldname}.`);
  }

  return await onSourceArchive(part);
}

function requireSourceUpload<T>(sourceUpload: T | undefined): T {
  if (sourceUpload === undefined) {
    throw new ApiBoundaryError(400, invalidSourceUploadRequestCode, 'Source archive file is required.');
  }

  return sourceUpload;
}

function isMultipartFilePart(part: Multipart): part is MultipartFile {
  return part.type === 'file';
}
