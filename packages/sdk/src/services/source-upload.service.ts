import {
  compartmentSourceUploadsPathname,
  sourceUploadArchiveMultipartFieldName,
  type SourceUploadCreateQuery,
  sourceUploadSummarySchema,
  type SourceUploadSummary,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';
import { buildListPath } from './list-path.service';

export async function createSourceUpload(
  request: CompartmentRequester,
  sourceArchive: Uint8Array,
  query: SourceUploadCreateQuery = {},
): Promise<SourceUploadSummary> {
  const formData: FormData = new FormData();
  formData.set(
    sourceUploadArchiveMultipartFieldName,
    new Blob([sourceArchive], { type: 'application/gzip' }),
    'source.tgz',
  );

  return await request<SourceUploadSummary, FormData>({
    body: formData,
    method: 'POST',
    path: buildSourceUploadPath(query),
    schema: sourceUploadSummarySchema,
  });
}

function buildSourceUploadPath(query: SourceUploadCreateQuery): string {
  return buildListPath(compartmentSourceUploadsPathname, [
    { name: 'projectName', value: query.projectName },
    { name: 'environmentName', value: query.environmentName },
    { name: 'serviceName', value: query.serviceName },
  ]);
}
