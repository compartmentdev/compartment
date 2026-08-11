import type { MultipartFile } from '@fastify/multipart';
import {
  compartmentSourceUploadsPathname,
  sourceUploadCreateQuerySchema,
  sourceUploadSummarySchema,
  type SourceUploadCreateQuery,
  type SourceUploadSummary,
} from '@compartment/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiApp } from '../../app.types';
import { applyTransportRequestTimeout, sourceArchiveRequestTimeoutMs } from '../../http/request-timeout';
import '../../http/request.types';
import { parseRequestValue } from '../../http/validation';
import { createCurrentOrganizationRouteResponseOptions } from '../protected/current-organization-route';
import { cleanupConsumedSourceUploadSafely } from '../cleanup-consumed-source-upload';
import { SourceUploadArchiveTooLargeError, createSourceUploadFromStream } from '../../services/source-uploads.service';
import type { CreatedSourceUpload, SourceUploadScope } from '../../services/source-uploads.service.types';
import { resolveSourceUploadScope } from '../../services/source-upload-scope.service';
import { recordAuditEvent } from '../../services/audit-events.service';
import { buildAuditEventForRequest } from '../audit/audit-event-route-context';
import { invalidSourceUploadRequestCode, parsePostSourceUploadRequest } from './post-source-upload.request';
import { createSourceArchiveTooLargeBoundaryError } from './source-upload-boundary-error';
import { buildSourceUploadSummary } from './source-upload.presenter';

const invalidSourceUploadQueryCode: string = 'invalid_source_upload_query';

export function registerPostSourceUploadRoute(app: ApiApp): void {
  app.post(
    compartmentSourceUploadsPathname,
    createCurrentOrganizationRouteResponseOptions(undefined, { 200: sourceUploadSummarySchema }),
    async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> =>
      await reply.send(await buildSourceUploadResponse(request)),
  );
}

async function buildSourceUploadResponse(request: FastifyRequest): Promise<SourceUploadSummary> {
  applyTransportRequestTimeout(request, sourceArchiveRequestTimeoutMs);
  const scope: SourceUploadScope = await resolveSourceUploadScopeForRequest(request);
  let sourceUploadId: string | null = null;

  try {
    const sourceUpload: CreatedSourceUpload = await parsePostSourceUploadRequest<CreatedSourceUpload>(
      request,
      async (sourceArchive: MultipartFile): Promise<CreatedSourceUpload> => {
        const createdSourceUpload: CreatedSourceUpload = await createSourceUploadFromMultipartFile(
          request,
          sourceArchive,
          scope,
        );
        sourceUploadId = createdSourceUpload.id;

        return createdSourceUpload;
      },
    );

    await recordSourceUploadAuditEvent(request, sourceUpload);
    return sourceUploadSummarySchema.parse(buildSourceUploadSummary(sourceUpload));
  } catch (error) {
    await cleanupConsumedSourceUploadSafely(sourceUploadId);
    throw toSourceUploadRouteError(error instanceof Error ? error : undefined);
  }
}

function toSourceUploadRouteError(error: Error | undefined): Error {
  if (error instanceof SourceUploadArchiveTooLargeError) {
    return createSourceArchiveTooLargeBoundaryError(invalidSourceUploadRequestCode);
  }

  return error ?? new Error('Source upload failed.');
}

async function resolveSourceUploadScopeForRequest(request: FastifyRequest): Promise<SourceUploadScope> {
  const query: SourceUploadCreateQuery = parseRequestValue(
    sourceUploadCreateQuerySchema,
    request.query,
    invalidSourceUploadQueryCode,
  );

  return await resolveSourceUploadScope({
    actorPrincipalId: request.actor.principalId,
    organizationId: request.currentOrganization.id,
    organizationSlug: request.currentOrganization.slug,
    query,
  });
}

async function createSourceUploadFromMultipartFile(
  request: FastifyRequest,
  sourceArchive: MultipartFile,
  scope: SourceUploadScope,
): Promise<CreatedSourceUpload> {
  return await createSourceUploadFromStream({
    actorPrincipalId: request.actor.principalId,
    authSession: request.actor.authSession,
    isTruncated: (): boolean => sourceArchive.file.truncated === true,
    organizationId: request.currentOrganization.id,
    scope,
    sourceArchiveStream: sourceArchive.file,
  });
}

async function recordSourceUploadAuditEvent(request: FastifyRequest, sourceUpload: CreatedSourceUpload): Promise<void> {
  await recordAuditEvent(
    buildAuditEventForRequest(request, {
      eventType: 'source.upload.created',
      metadata: {
        byteSize: sourceUpload.byteSize,
        expiresAt: sourceUpload.expiresAt.toISOString(),
      },
      target: {
        environmentId: sourceUpload.environmentId,
        id: sourceUpload.id,
        projectId: sourceUpload.projectId,
        serviceId: sourceUpload.projectServiceId,
        type: 'source_upload',
      },
    }),
  );
}
