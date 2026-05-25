import type { FastifyRequest } from 'fastify';
import type { ApiConfig } from '../../config';
import { getApiConfig } from '../../runtime/runtime-access';
import { buildRuntimePublicSettings } from '../../services/public-hosts.service';
import type { InstallationPublicSettings } from '../../services/public-hosts.service.types';

export function buildCurrentBrowserUrl(request: FastifyRequest): URL {
  const config: ApiConfig = getApiConfig();
  const publicSettings: InstallationPublicSettings = buildRuntimePublicSettings(config);

  return new URL(request.url, `${publicSettings.compartmentUrl}/`);
}
