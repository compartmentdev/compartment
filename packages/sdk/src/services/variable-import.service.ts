import {
  compartmentVariableImportPathname,
  importVariablesRequestSchema,
  importVariablesResponseSchema,
  type ImportVariablesRequest,
  type ImportVariablesResponse,
} from '@compartment/contracts';
import type { CompartmentRequester } from '../http/request.types';

export async function importVariables(
  request: CompartmentRequester,
  body: ImportVariablesRequest,
): Promise<ImportVariablesResponse> {
  return await request<ImportVariablesResponse, ImportVariablesRequest>({
    body: importVariablesRequestSchema.parse(body),
    method: 'POST',
    path: compartmentVariableImportPathname,
    schema: importVariablesResponseSchema,
  });
}
