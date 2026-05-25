import type { ApiConfig } from '../config';
import { buildRuntimePublicSettings } from './public-hosts.service';

export function buildBrowserAuthTokenUrl(pathname: string, email: string, token: string, config: ApiConfig): string {
  const url: URL = new URL(pathname, `${buildRuntimePublicSettings(config).compartmentUrl}/`);
  url.searchParams.set('email', email);
  url.searchParams.set('token', token);

  return url.toString();
}
