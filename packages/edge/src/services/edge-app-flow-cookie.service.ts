import { appAccessFlowTtlSeconds, readCompartmentAppFlowCookieName } from '@compartment/contracts';
import { readCookieValue, serializeCookie } from '@compartment/utils';
import { buildEdgeBrowserCookieOptions } from './edge-browser-cookie.service';

export function buildAppFlowStateCookie(state: string): string {
  return serializeCookie(readCompartmentAppFlowCookieName(state), '1', {
    maxAgeSeconds: appAccessFlowTtlSeconds,
    ...buildEdgeBrowserCookieOptions(),
  });
}

export function buildClearedAppFlowStateCookie(state: string): string {
  return serializeCookie(readCompartmentAppFlowCookieName(state), '', {
    expires: new Date(0),
    maxAgeSeconds: 0,
    ...buildEdgeBrowserCookieOptions(),
  });
}

export function hasAppFlowStateCookie(cookieHeader: string | undefined, state: string): boolean {
  return readCookieValue(cookieHeader, readCompartmentAppFlowCookieName(state)) === '1';
}
