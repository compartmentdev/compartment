import type { SourceUploadSummary } from '@compartment/contracts';
import type { CreatedSourceUpload } from '../../services/source-uploads.service.types';

export function buildSourceUploadSummary(sourceUpload: CreatedSourceUpload): SourceUploadSummary {
  return {
    byteSize: sourceUpload.byteSize,
    createdAt: sourceUpload.createdAt.toISOString(),
    expiresAt: sourceUpload.expiresAt.toISOString(),
    id: sourceUpload.id,
    sourceDigest: sourceUpload.sourceDigest,
  };
}
