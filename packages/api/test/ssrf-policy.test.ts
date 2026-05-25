import { generateKeyPairSync } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { buildDefaultSsoOidcIdentityVerificationConfig } from '@compartment/contracts';
import type { ApiConfig } from '../src/config';
import type { Database } from '../src/db/client';
import { configureApiRuntime, clearApiRuntime } from '../src/runtime/runtime';
import { readGitHubAppManifestPlan } from '../src/services/git-source/github-app-bootstrap.adapter';
import {
  assertGitHubAppStillExists,
  readGitHubRepositoryMetadata,
} from '../src/services/git-source/github-app-client.adapter';
import { buildOidcAuthorizationPlan, readOidcCallbackClaims } from '../src/services/sso-oidc/sso-oidc-client.adapter';
import { createSsoOidcApiConfig } from './sso-oidc/sso-oidc-login.service.fixtures';
import { startLocalHttpsServer, type LocalHttpsServerHandle } from './support/local-https-server';

interface OidcDiscoveryResponse {
  authorization_endpoint: string;
  id_token_signing_alg_values_supported: string[];
  issuer: string;
  response_types_supported: string[];
  scopes_supported: string[];
  subject_types_supported: string[];
  token_endpoint: string;
}

interface ErrorWithCause extends Error {
  cause?: Error | undefined;
}

describe('API SSRF policy', (): void => {
  afterEach((): void => {
    clearApiRuntime();
  });

  it('blocks a GitHub Enterprise provider host that resolves to loopback', async (): Promise<void> => {
    const server: LocalHttpsServerHandle = await startLocalHttpsServer(
      (request: IncomingMessage, response: ServerResponse): void => {
        if (request.url === '/api/v3/users/acme') {
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ type: 'User' }));
          return;
        }

        response.writeHead(404, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ message: 'not found' }));
      },
    );

    try {
      configureRuntimeWithTrustedHost(new URL(server.origin).host);
      await expect(
        readGitHubAppManifestPlan({
          callbackUrl: 'https://console.example.com/v1/sources/git/providers/github/callback',
          controlPlaneUrl: 'https://console.example.com',
          providerHost: new URL(server.origin).host,
          repositoryOwner: 'acme',
          setupUrl: 'https://console.example.com/v1/sources/git/providers/github/setup',
          webhookUrl: 'https://console.example.com/v1/sources/git/providers/github/webhook',
        }),
      ).rejects.toThrow('unsafe address 127.0.0.1');

      expect(server.requests).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it('blocks GitHub App authentication against a loopback provider host', async (): Promise<void> => {
    const server: LocalHttpsServerHandle = await startLocalHttpsServer(
      (_request: IncomingMessage, response: ServerResponse): void => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ id: 12345 }));
      },
    );

    try {
      configureRuntimeWithTrustedHost(new URL(server.origin).host);
      await expectRejectedErrorChainToContain(async (): Promise<void> => {
        await assertGitHubAppStillExists({
          appId: '12345',
          privateKeyPem: createGitHubPrivateKeyPem(),
          providerHost: new URL(server.origin).host,
        });
      }, 'unsafe address 127.0.0.1');

      expect(server.requests).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it('blocks GitHub installation repository reads against a loopback provider host', async (): Promise<void> => {
    const server: LocalHttpsServerHandle = await startLocalHttpsServer(
      (_request: IncomingMessage, response: ServerResponse): void => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ token: 'installation-token' }));
      },
    );

    try {
      configureRuntimeWithTrustedHost(new URL(server.origin).host);
      await expectRejectedErrorChainToContain(async (): Promise<void> => {
        await readGitHubRepositoryMetadata({
          appId: '12345',
          installationId: '98765',
          owner: 'acme',
          privateKeyPem: createGitHubPrivateKeyPem(),
          providerHost: new URL(server.origin).host,
          repositoryName: 'platform',
        });
      }, 'unsafe address 127.0.0.1');

      expect(server.requests).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it('blocks an SSO OIDC authorization issuer URL that resolves to loopback', async (): Promise<void> => {
    let issuer: string = '';
    const server: LocalHttpsServerHandle = await startLocalHttpsServer(
      (_request: IncomingMessage, response: ServerResponse): void => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(buildOidcDiscoveryResponse(issuer)));
      },
    );
    issuer = server.origin;

    try {
      configureRuntimeWithTrustedHost(new URL(server.origin).host);
      await expectRejectedErrorChainToContain(async (): Promise<void> => {
        await buildOidcAuthorizationPlan({
          clientId: 'client-id',
          clientSecret: 'client-secret',
          issuerUrl: server.origin,
          redirectUri: 'https://console.example.com/login/sso/callback',
          scope: 'openid email profile',
        });
      }, 'unsafe address 127.0.0.1');

      expect(server.requests).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it('blocks an SSO OIDC callback issuer URL that resolves to loopback', async (): Promise<void> => {
    let issuer: string = '';
    const server: LocalHttpsServerHandle = await startLocalHttpsServer(
      (_request: IncomingMessage, response: ServerResponse): void => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(buildOidcDiscoveryResponse(issuer)));
      },
    );
    issuer = server.origin;

    try {
      configureRuntimeWithTrustedHost(new URL(server.origin).host);
      await expect(
        readOidcCallbackClaims({
          clientId: 'client-id',
          clientSecret: 'client-secret',
          currentUrl: new URL('https://console.example.com/login/sso/callback?code=code&state=state'),
          expectedNonce: 'nonce',
          expectedState: 'state',
          identityVerification: buildDefaultSsoOidcIdentityVerificationConfig(),
          issuerUrl: server.origin,
          pkceCodeVerifier: 'pkce-code-verifier',
          redirectUri: 'https://console.example.com/login/sso/callback',
          scope: 'openid email profile',
        }),
      ).rejects.toThrow('The SSO login could not be completed.');

      expect(server.requests).toHaveLength(0);
    } finally {
      await server.close();
    }
  });
});

async function expectRejectedErrorChainToContain(run: () => Promise<void>, message: string): Promise<void> {
  const error: Error = await readRejectedError(run);
  expect(readErrorChainMessages(error)).toContainEqual(expect.stringContaining(message));
}

async function readRejectedError(run: () => Promise<void>): Promise<Error> {
  try {
    await run();
  } catch (caughtError) {
    if (caughtError instanceof Error) {
      return caughtError;
    }

    return new Error(String(caughtError));
  }

  throw new Error('Expected operation to reject.');
}

function readErrorChainMessages(error: Error): string[] {
  const messages: string[] = [];
  let currentError: Error | undefined = error;
  while (currentError !== undefined) {
    messages.push(currentError.message);
    currentError = (currentError as ErrorWithCause).cause;
  }

  return messages;
}

function configureRuntimeWithTrustedHost(host: string): void {
  const config: ApiConfig = {
    ...createSsoOidcApiConfig(),
    trustedOutboundHosts: [host],
  };
  configureApiRuntime({
    config,
    db: {} as Database,
  });
}

function createGitHubPrivateKeyPem(): string {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
  }).privateKey.export({
    format: 'pem',
    type: 'pkcs8',
  }) as string;
}

function buildOidcDiscoveryResponse(issuer: string): OidcDiscoveryResponse {
  return {
    authorization_endpoint: `${issuer}/authorize`,
    id_token_signing_alg_values_supported: ['HS256'],
    issuer,
    response_types_supported: ['code'],
    scopes_supported: ['openid', 'email', 'profile'],
    subject_types_supported: ['public'],
    token_endpoint: `${issuer}/token`,
  };
}
