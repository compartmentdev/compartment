import type { FastifyReply } from 'fastify';
import { renderBrowserAppShellPage } from './browser-app-shell.page';

interface BrowserAuthTokenQuery {
  token?: string | undefined;
}

type CreateAuthTokenFlowCookies<Query extends BrowserAuthTokenQuery> = (
  query: Query,
  token: string,
) => Promise<string[]>;
type CreateAuthTokenShellCookies = () => string[];

export async function replyWithBrowserAuthTokenLanding<Query extends BrowserAuthTokenQuery>(
  reply: FastifyReply,
  query: Query,
  title: string,
  createFlowCookies: CreateAuthTokenFlowCookies<Query>,
  createShellCookies: CreateAuthTokenShellCookies,
  buildGetUrl: (query: Query) => string,
): Promise<FastifyReply> {
  if (query.token !== undefined) {
    reply.header('Set-Cookie', await createFlowCookies(query, query.token));

    return await reply.redirect(buildGetUrl(query));
  }

  reply.header('Set-Cookie', createShellCookies());

  return await reply
    .code(200)
    .type('text/html; charset=utf-8')
    .send(
      renderBrowserAppShellPage({
        bundle: 'auth',
        title,
      }),
    );
}
