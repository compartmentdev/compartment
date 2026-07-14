import {
  compartmentGitHubProviderBootstrapStartPathnameTemplate,
  compartmentGitHubProviderCallbackPathname,
  compartmentGitHubProviderSetupPathname,
  compartmentGitHubSourceWebhookPathnameTemplate,
} from '@compartment/contracts';
import { hasText, isSafeRelativePath, readHeaderValue } from '@compartment/utils';
import type { FastifyReply, FastifyRequest } from 'fastify';
import '../../http/request.types';
import type { ApiApp } from '../../app.types';
import { browserLoginPathname } from '../../browser-public-paths';
import {
  createGitSourceRequestInvalidError,
  isGitSourceRepositoryAccessDeniedError,
} from '../../errors/api-business-error';
import { gitSourceBootstrapInvalidErrorCode, gitSourceInvalidRequestErrorCode } from '../../git-source.constants';
import { parseRequestValue } from '../../http/validation';
import { authenticateBrowserCompartmentActor } from '../../services/app-access.service';
import type { Actor } from '../../services/auth-actor.types';
import { escapeHtml } from '../browser/browser-page.shared';
import { readCompartmentSessionToken } from '../browser/browser-flow.helpers';
import {
  completeGitHubProviderBootstrapCallback,
  completeGitHubProviderBootstrapSetup,
} from '../../services/git-source/git-source-bootstrap-completion.service';
import {
  readGitHubProviderBootstrapPage,
  renderGitHubProviderBootstrapSuccessPage,
} from '../../services/git-source/git-source-bootstrap.service';
import { handleGitHubSourceWebhook } from '../../services/git-source/github-source-webhook.service';
import {
  gitHubBootstrapStateRouteParamsSchema,
  gitHubCallbackQuerySchema,
  gitHubSetupQuerySchema,
  gitHubSourceWebhookRouteParamsSchema,
  type GitHubBootstrapStateRouteParams,
  type GitHubCallbackQuery,
  type GitHubSetupQuery,
  type GitHubSourceWebhookRouteParams,
} from './source-git.route.types';
import type { GitHubWebhookObject } from '../../services/git-source/git-source-runtime.service.types';
import type { GitHubProviderBootstrapPage } from '../../services/git-source/git-source.service.types';
import {
  gitSourcePublicRateLimitRouteOptions,
  gitSourceWebhookRateLimitRouteOptions,
} from './source-git-public-rate-limit.route';

const gitHubBootstrapStartPathname: string = compartmentGitHubProviderBootstrapStartPathnameTemplate;
const gitHubCallbackPathname: string = compartmentGitHubProviderCallbackPathname;
const gitHubSetupPathname: string = compartmentGitHubProviderSetupPathname;
const gitHubSourceWebhookPathname: string = compartmentGitHubSourceWebhookPathnameTemplate;
const gitHubAppInstallRedirectDelayMs: number = 3_000;

export function registerGitSourcePublicRoutes(app: ApiApp): void {
  app.get(gitHubBootstrapStartPathname, gitSourcePublicRateLimitRouteOptions, handleGitHubProviderBootstrapStartPage);
  app.get(gitHubCallbackPathname, gitSourcePublicRateLimitRouteOptions, handleGitHubProviderBootstrapCallback);
  app.get(gitHubSetupPathname, gitSourcePublicRateLimitRouteOptions, handleGitHubProviderBootstrapSetup);
  app.post(gitHubSourceWebhookPathname, gitSourceWebhookRateLimitRouteOptions, handleGitHubSourceWebhookRoute);
}

async function handleGitHubProviderBootstrapStartPage(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const params: GitHubBootstrapStateRouteParams = parseRequestValue(
    gitHubBootstrapStateRouteParamsSchema,
    request.params,
    gitSourceBootstrapInvalidErrorCode,
  );
  const actor: Actor | null = await authenticateBrowserCompartmentActor(readCompartmentSessionToken(request));
  if (actor === null) {
    return await reply.redirect(browserLoginPathname);
  }
  const page: GitHubProviderBootstrapPage = await readGitHubProviderBootstrapPage({
    actorPrincipalId: actor.principalId,
    bootstrapStateId: params.bootstrapStateId,
  });

  if (page.kind === 'install') {
    return await sendGitHubProviderBootstrapInstallPage(reply, page.installUrl);
  }

  return await reply
    .code(200)
    .type('text/html; charset=utf-8')
    .send(renderGitHubProviderBootstrapStartPage(page.formActionUrl, page.manifestJson, page.stateNonce));
}

async function handleGitHubProviderBootstrapCallback(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const query: GitHubCallbackQuery = parseRequestValue(
    gitHubCallbackQuerySchema,
    request.query,
    gitSourceBootstrapInvalidErrorCode,
  );
  const installUrl: string = await completeGitHubProviderBootstrapCallback(query.code, query.state);

  return await sendGitHubProviderBootstrapInstallPage(reply, installUrl);
}

async function handleGitHubProviderBootstrapSetup(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const query: GitHubSetupQuery = parseRequestValue(
    gitHubSetupQuerySchema,
    request.query,
    gitSourceBootstrapInvalidErrorCode,
  );
  let returnTo: string | null;
  try {
    returnTo = await completeGitHubProviderBootstrapSetup(query.state, query.installation_id);
  } catch (error) {
    const businessError: Error | undefined = error instanceof Error ? error : undefined;
    if (isGitSourceRepositoryAccessDeniedError(businessError)) {
      request.log.warn(
        { error, upstreamError: readErrorCauseMessage(businessError) },
        'GitHub bootstrap setup verification failed.',
      );
    }

    throw error;
  }
  if (returnTo !== null) {
    return await reply.redirect(requireSafeGitHubBootstrapReturnTo(returnTo));
  }
  return await reply.code(200).type('text/html; charset=utf-8').send(renderGitHubProviderBootstrapSuccessPage());
}

function requireSafeGitHubBootstrapReturnTo(returnTo: string): string {
  if (isSafeRelativePath(returnTo)) {
    return returnTo;
  }

  throw new Error('GitHub bootstrap return path must be a safe relative path.');
}

async function handleGitHubSourceWebhookRoute(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const params: GitHubSourceWebhookRouteParams = parseRequestValue(
    gitHubSourceWebhookRouteParamsSchema,
    request.params,
    gitSourceInvalidRequestErrorCode,
  );
  await handleGitHubSourceWebhook({
    body: request.body as GitHubWebhookObject,
    eventType: requireGitHubHeaderValue(request.headers['x-github-event'], 'x-github-event'),
    providerDeliveryId: requireGitHubHeaderValue(request.headers['x-github-delivery'], 'x-github-delivery'),
    rawBody: request.rawBody ?? Buffer.alloc(0),
    organizationId: params.organizationId,
    registrationId: params.registrationId,
    signature: requireGitHubHeaderValue(request.headers['x-hub-signature-256'], 'x-hub-signature-256'),
  });
  return await reply.code(202).send(null);
}

function renderGitHubProviderBootstrapStartPage(
  formActionUrl: string,
  manifestJson: string,
  stateNonce: string,
): string {
  return buildGitHubProviderBootstrapStartPageMarkup(
    escapeHtml(formActionUrl),
    escapeHtml(manifestJson),
    escapeHtml(stateNonce),
  );
}

async function sendGitHubProviderBootstrapInstallPage(reply: FastifyReply, installUrl: string): Promise<FastifyReply> {
  return await reply
    .code(200)
    .type('text/html; charset=utf-8')
    .send(renderGitHubProviderBootstrapInstallPage(installUrl));
}

function renderGitHubProviderBootstrapInstallPage(installUrl: string): string {
  return buildGitHubProviderBootstrapInstallPageMarkup(
    escapeHtml(installUrl),
    gitHubAppInstallRedirectDelayMs.toString(),
  );
}

function buildGitHubProviderBootstrapInstallPageMarkup(escapedInstallUrl: string, redirectDelayMs: string): string {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<body>',
    '<p>Preparing GitHub App installation...</p>',
    '<p><a id="install-link" href="',
    escapedInstallUrl,
    '">Continue to GitHub</a></p>',
    '<script>',
    'window.setTimeout(function(){window.location.assign(document.getElementById("install-link").href);},',
    redirectDelayMs,
    ');',
    '</script>',
    '</body>',
    '</html>',
  ].join('');
}

function buildGitHubProviderBootstrapStartPageMarkup(
  escapedActionUrl: string,
  escapedManifestJson: string,
  escapedStateNonce: string,
): string {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<body>',
    '<form id="bootstrap-form" method="post" action="',
    escapedActionUrl,
    '">',
    buildGitHubProviderBootstrapHiddenInputs(escapedManifestJson, escapedStateNonce),
    '<p>Redirecting to GitHub App registration...</p>',
    '<button type="submit">Continue</button>',
    '</form>',
    '<script>document.getElementById("bootstrap-form")?.submit();</script>',
    '</body>',
    '</html>',
  ].join('');
}

function buildGitHubProviderBootstrapHiddenInputs(escapedManifestJson: string, escapedStateNonce: string): string {
  return [
    '<input type="hidden" name="manifest" value="',
    escapedManifestJson,
    '">',
    '<input type="hidden" name="state" value="',
    escapedStateNonce,
    '">',
  ].join('');
}

function requireGitHubHeaderValue(value: string | string[] | undefined, headerName: string): string {
  const headerValue: string | undefined = readHeaderValue(value);
  if (hasText(headerValue)) {
    return headerValue;
  }

  throw createGitSourceRequestInvalidError(`GitHub webhook header ${headerName} is required.`);
}

function readErrorCauseMessage(error: Error): string | undefined {
  return error.cause instanceof Error ? error.cause.message : undefined;
}
