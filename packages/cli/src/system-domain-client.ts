import type { SystemDomainApiRequest, SystemDomainClientConfig } from './system-domain-client.types';
import { requestSystemApi } from './system-api-client';

export async function requestSystemDomainApi<TResponse>(
  config: SystemDomainClientConfig,
  input: SystemDomainApiRequest<TResponse>,
): Promise<TResponse> {
  return await requestSystemApi(config, input);
}
