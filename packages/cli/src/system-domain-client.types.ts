import type { SystemApiClientConfig, SystemApiRequest } from './system-api-client.types';

export type SystemDomainClientConfig = SystemApiClientConfig;
export type SystemDomainApiRequest<TResponse> = SystemApiRequest<TResponse>;
