import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  createForbiddenError,
  createInvalidSourceUploadError,
  createSourceUploadAlreadyConsumedError,
  createSourceUploadExpiredError,
  createSourceUploadNotFoundError,
} from '../errors/api-business-error';
import { createId } from '../lib/tokens';
import {
  createSourceUpload,
  deleteSourceUploadById,
  findSourceUploadByIdForOrganization,
  hasRetainedSourceUploadReferences,
} from '../queries/source-uploads.query';
import type { SourceUploadRow } from '../queries/source-uploads.query.types';
import { validateSourceUploadArchive } from './deployment-source-build-validation-archive.service';
import {
  deleteSourceUploadArchive,
  copySourceUploadArchiveFromPath,
  resolveSourceUploadArchivePath,
  storeSourceUploadArchive,
} from './source-upload-storage.service';
import type {
  CreateSourceUploadArchivePathInput,
  CreatedSourceUpload,
  CreateSourceUploadStreamInput,
  ConsumeSourceUploadContext,
  DeployableSourceUpload,
  PreparedSourceUploadArchive,
} from './source-uploads.service.types';
import { readUnscopedSourceUploadScope } from './source-upload-scope.service';
import {
  cleanupSourceUploadsBestEffort,
  deleteSourceUploadArchiveBestEffort,
  SourceUploadArchiveTooLargeError,
  throwIfSourceArchiveTruncated,
  toCreatedSourceUpload,
  toSourceUploadValidationError,
} from './source-uploads.service.support';
import {
  requireActiveHumanRuntimeSessionActor,
  requireActiveSourceAutomationRuntimeActor,
} from './runtime-actor-authorization.service';

const sourceUploadTtlMs: number = 60 * 60 * 1000;
export { SourceUploadArchiveTooLargeError } from './source-uploads.service.support';

export async function createSourceUploadFromStream(input: CreateSourceUploadStreamInput): Promise<CreatedSourceUpload> {
  const now: Date = new Date();
  await requireActiveHumanRuntimeSessionActor({
    organizationId: input.organizationId,
    principalId: input.actorPrincipalId,
    session: input.authSession,
  });
  const preparedArchive: PreparedSourceUploadArchive = await prepareSourceUploadArchive(input, now);
  await validatePreparedSourceUploadForPersist(input, preparedArchive);
  return toCreatedSourceUpload(await persistPreparedSourceUploadRecord(input, preparedArchive, now));
}

export async function createSourceUploadFromArchivePath(
  input: CreateSourceUploadArchivePathInput,
): Promise<CreatedSourceUpload> {
  const now: Date = new Date();
  await requireActiveSourceAutomationRuntimeActor({
    organizationId: input.organizationId,
    principalId: input.actorPrincipalId,
    sourceId: input.sourceId,
  });
  await cleanupSourceUploadsBestEffort(now);

  const sourceUploadId: string = createId('sup');
  const preparedArchive: PreparedSourceUploadArchive = await readPreparedSourceUploadArchive(
    sourceUploadId,
    input.archivePath,
  );

  return await persistArchivePathSourceUploadWithCleanup(input, preparedArchive, now);
}

export async function requireDeployableSourceUpload(
  input: ConsumeSourceUploadContext,
): Promise<DeployableSourceUpload> {
  const now: Date = new Date();
  try {
    return await requireSourceUploadForDeployment(input, now);
  } finally {
    await cleanupSourceUploadsBestEffort(now, input.sourceUploadId);
  }
}

export async function cleanupConsumedSourceUpload(sourceUploadId: string): Promise<void> {
  if (await hasRetainedSourceUploadReferences(sourceUploadId)) {
    return;
  }

  await deleteSourceUploadArchive(sourceUploadId);
  await deleteSourceUploadById(sourceUploadId);
}

async function prepareSourceUploadArchive(
  input: CreateSourceUploadStreamInput,
  now: Date,
): Promise<PreparedSourceUploadArchive> {
  await cleanupSourceUploadsBestEffort(now);

  const sourceUploadId: string = createId('sup');

  return {
    sourceUploadId,
    storedArchive: await storeSourceUploadArchive(sourceUploadId, input.sourceArchiveStream),
  };
}

async function readPreparedSourceUploadArchive(
  sourceUploadId: string,
  archivePath: string,
): Promise<PreparedSourceUploadArchive> {
  await validateSourceUploadArchive(archivePath);
  const archiveBuffer: Buffer = await readFile(archivePath);

  return {
    sourceUploadId,
    storedArchive: {
      archiveBase64: archiveBuffer.toString('base64'),
      byteSize: archiveBuffer.byteLength,
      sourceDigest: createHash('sha256').update(archiveBuffer).digest('hex'),
    },
  };
}

async function persistArchivePathSourceUploadWithCleanup(
  input: CreateSourceUploadArchivePathInput,
  preparedArchive: PreparedSourceUploadArchive,
  now: Date,
): Promise<CreatedSourceUpload> {
  try {
    return await persistArchivePathSourceUpload(input, preparedArchive, now);
  } catch (error) {
    await deleteSourceUploadArchiveBestEffort(preparedArchive.sourceUploadId);
    throw error;
  }
}

async function persistArchivePathSourceUpload(
  input: CreateSourceUploadArchivePathInput,
  preparedArchive: PreparedSourceUploadArchive,
  now: Date,
): Promise<CreatedSourceUpload> {
  await copySourceUploadArchiveFromPath(preparedArchive.sourceUploadId, input.archivePath);

  return toCreatedSourceUpload(
    await persistSourceUploadRecord(
      {
        actorPrincipalId: input.actorPrincipalId,
        organizationId: input.organizationId,
        scope: readUnscopedSourceUploadScope(),
      },
      preparedArchive,
      now,
    ),
  );
}

async function validatePreparedSourceUploadForPersist(
  input: CreateSourceUploadStreamInput,
  preparedArchive: PreparedSourceUploadArchive,
): Promise<void> {
  try {
    throwIfSourceArchiveTruncated(input);
    validateStoredSourceUploadArchive(preparedArchive);
    await validatePreparedSourceUploadArchive(preparedArchive);
  } catch (error) {
    await deleteSourceUploadArchiveBestEffort(preparedArchive.sourceUploadId);
    if (error instanceof SourceUploadArchiveTooLargeError) {
      throw error;
    }
    throw toSourceUploadValidationError(error instanceof Error ? error : undefined);
  }
}

async function validatePreparedSourceUploadArchive(preparedArchive: PreparedSourceUploadArchive): Promise<void> {
  await validateSourceUploadArchive(resolveSourceUploadArchivePath(preparedArchive.sourceUploadId));
}

function validateStoredSourceUploadArchive(preparedArchive: PreparedSourceUploadArchive): void {
  if (preparedArchive.storedArchive.byteSize > 0) {
    return;
  }

  throw createInvalidSourceUploadError(`Source archive ${preparedArchive.sourceUploadId} must not be empty.`);
}

async function persistPreparedSourceUploadRecord(
  input: CreateSourceUploadStreamInput,
  preparedArchive: PreparedSourceUploadArchive,
  now: Date,
): Promise<DeployableSourceUpload> {
  try {
    return await persistSourceUploadRecord(input, preparedArchive, now);
  } catch (error) {
    await deleteSourceUploadArchiveBestEffort(preparedArchive.sourceUploadId);
    throw error;
  }
}

async function persistSourceUploadRecord(
  input: Pick<CreateSourceUploadStreamInput, 'actorPrincipalId' | 'organizationId' | 'scope'>,
  preparedArchive: PreparedSourceUploadArchive,
  now: Date,
): Promise<DeployableSourceUpload> {
  return await createSourceUpload({
    archiveBase64: preparedArchive.storedArchive.archiveBase64,
    byteSize: preparedArchive.storedArchive.byteSize,
    createdByPrincipalId: input.actorPrincipalId,
    environmentId: input.scope.environmentId,
    expiresAt: new Date(now.getTime() + sourceUploadTtlMs),
    id: preparedArchive.sourceUploadId,
    organizationId: input.organizationId,
    projectId: input.scope.projectId,
    projectServiceId: input.scope.projectServiceId,
    sourceDigest: preparedArchive.storedArchive.sourceDigest,
  });
}

async function requireSourceUploadForDeployment(
  input: ConsumeSourceUploadContext,
  now: Date,
): Promise<DeployableSourceUpload> {
  const sourceUpload: SourceUploadRow | undefined = await findSourceUploadByIdForOrganization(input);

  if (sourceUpload === undefined) {
    throw createSourceUploadNotFoundError();
  }
  assertSourceUploadPrincipal(input, sourceUpload);
  if (sourceUpload.expiresAt <= now) {
    throw createSourceUploadExpiredError();
  }
  if (sourceUpload.consumedAt !== null) {
    throw createSourceUploadAlreadyConsumedError();
  }

  return sourceUpload;
}

function assertSourceUploadPrincipal(input: ConsumeSourceUploadContext, sourceUpload: SourceUploadRow): void {
  if (sourceUpload.createdByPrincipalId === input.actorPrincipalId) {
    return;
  }

  throw createForbiddenError();
}
