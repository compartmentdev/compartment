import { cleanupConsumedSourceUpload } from '../services/source-uploads.service';

export async function cleanupConsumedSourceUploadSafely(sourceUploadId: string | null): Promise<void> {
  if (sourceUploadId === null) {
    return;
  }

  try {
    await cleanupConsumedSourceUpload(sourceUploadId);
  } catch {
    return;
  }
}
