import {
  compartmentWhoAmIPathname,
  whoamiQuerySchema,
  whoamiResponseSchema,
  type WhoAmIQuery,
  type WhoAmIResponse,
} from '@compartment/contracts';

import type { CompartmentRequester } from '../http/request.types';
import { buildListPath } from './list-path.service';

export async function getWhoAmI(request: CompartmentRequester, query: WhoAmIQuery = {}): Promise<WhoAmIResponse> {
  return await request<WhoAmIResponse, undefined>({
    method: 'GET',
    path: buildWhoAmIPath(query),
    schema: whoamiResponseSchema,
  });
}

function buildWhoAmIPath(query: WhoAmIQuery): string {
  const parsedQuery: WhoAmIQuery = whoamiQuerySchema.parse(query);
  return buildListPath(compartmentWhoAmIPathname, [
    { name: 'projectName', value: parsedQuery.projectName },
    { name: 'environmentName', value: parsedQuery.environmentName },
  ]);
}
