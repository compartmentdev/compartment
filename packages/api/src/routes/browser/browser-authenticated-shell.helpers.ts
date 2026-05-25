import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  browserLoginPathname,
  browserLoginSuccessRedirectSearchParamName,
  browserOnboardingPathname,
  browserProjectCreatePathname,
} from '../../browser-public-paths';
import { authenticateBrowserCompartmentSession } from '../../services/app-access.service';
import type { BrowserCompartmentSession } from '../../services/app-access.service.types';
import { createBrowserCsrfCookie } from '../../services/browser-csrf-cookie.service';
import { readCompartmentSessionToken } from './browser-flow.helpers';

type RenderBrowserShell = () => string;

export async function sendAuthenticatedBrowserShell(
  request: FastifyRequest,
  reply: FastifyReply,
  renderShell: RenderBrowserShell,
): Promise<FastifyReply> {
  const session: BrowserCompartmentSession | null = await authenticateBrowserCompartmentSession(
    readCompartmentSessionToken(request),
  );
  if (session === null) {
    return await reply.redirect(readBrowserShellLoginRedirectUrl(request));
  }

  reply.header('Set-Cookie', createBrowserCsrfCookie());

  return await reply.code(200).type('text/html; charset=utf-8').send(renderShell());
}

function readBrowserShellLoginRedirectUrl(request: FastifyRequest): string {
  const successRedirectTo: string | undefined = readBrowserShellSuccessRedirectTo(request.url);
  if (successRedirectTo === undefined) {
    return browserLoginPathname;
  }

  const searchParams: URLSearchParams = new URLSearchParams({
    [browserLoginSuccessRedirectSearchParamName]: successRedirectTo,
  });
  return `${browserLoginPathname}?${searchParams.toString()}`;
}

function readBrowserShellSuccessRedirectTo(requestUrl: string): string | undefined {
  const url: URL = new URL(requestUrl, 'http://console.localhost');
  return isBrowserShellSuccessRedirectPath(url.pathname) ? `${url.pathname}${url.search}` : undefined;
}

function isBrowserShellSuccessRedirectPath(pathname: string): boolean {
  return pathname.endsWith(browserOnboardingPathname) || pathname.endsWith(browserProjectCreatePathname);
}
