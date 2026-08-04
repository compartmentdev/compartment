import type { Multipart, MultipartFile, MultipartValue } from '@fastify/multipart';
import {
  logicalSourceDigestSchema,
  sourceUploadArchiveMultipartFieldName,
  sourceUploadDigestMultipartFieldName,
} from '@compartment/contracts';
import type { FastifyRequest } from 'fastify';
import { ApiBoundaryError } from '../../errors/api-boundary-error';
import { getApiConfig } from '../../runtime/runtime-access';

export const invalidSourceUploadRequestCode: string = 'invalid_source_upload_request';

type SourceUploadPartHandler<T> = (sourceArchive: MultipartFile, sourceDigest: string) => Promise<T>;

export async function parsePostSourceUploadRequest<T>(
  request: FastifyRequest,
  onSourceArchive: SourceUploadPartHandler<T>,
): Promise<T> {
  if (!request.isMultipart()) {
    throw new ApiBoundaryError(400, invalidSourceUploadRequestCode, 'Expected multipart/form-data request body.');
  }

  let sourceUpload: T | undefined;
  let sourceDigest: string | undefined;
  for await (const part of request.parts(readSourceUploadMultipartOptions())) {
    if (isDigestPart(part) && sourceDigest === undefined && sourceUpload === undefined) {
      sourceDigest = requireLogicalSourceDigest(part.value);
    } else if (
      isMultipartFilePart(part) &&
      part.fieldname === sourceUploadArchiveMultipartFieldName &&
      sourceUpload === undefined
    ) {
      sourceUpload = await onSourceArchive(part, requireSourceDigest(sourceDigest));
    } else {
      throw new ApiBoundaryError(400, invalidSourceUploadRequestCode, `Unexpected field ${part.fieldname}.`);
    }
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

function isDigestPart(part: Multipart): part is MultipartValue<string> {
  return (
    part.type === 'field' && part.fieldname === sourceUploadDigestMultipartFieldName && typeof part.value === 'string'
  );
}

function requireLogicalSourceDigest(value: string): string {
  const parsed: string | undefined = logicalSourceDigestSchema.safeParse(value).data;
  if (parsed === undefined) {
    throw new ApiBoundaryError(400, invalidSourceUploadRequestCode, 'Source digest is invalid.');
  }
  return parsed;
}

function requireSourceDigest(sourceDigest: string | undefined): string {
  if (sourceDigest === undefined) {
    throw new ApiBoundaryError(400, invalidSourceUploadRequestCode, 'Source digest field must precede the archive.');
  }
  return sourceDigest;
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
