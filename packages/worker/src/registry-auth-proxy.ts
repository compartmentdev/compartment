import {
  createServer,
  request as createHttpRequest,
  type ClientRequest,
  type IncomingMessage,
  type RequestOptions,
  type Server,
  type ServerResponse,
} from 'node:http';
import { readFileSync } from 'node:fs';
import { createServer as createHttpsServer } from 'node:https';
import { pipeline, type Duplex } from 'node:stream';
import { z } from 'zod';
import {
  sendBadRequest,
  sendForbidden,
  sendUnauthorized,
  writeRawBadRequest,
  writeRawUnauthorized,
} from './registry-auth-proxy-responses';
import { buildProxyRequestHeaders, buildProxyResponseHeaders } from './registry-auth-proxy-headers';
import { resolveAuthorizedRegistryRequestTarget } from './registry-auth-proxy-request';
import { isRegistryRepositoryPath, resolvePublicBuildKitSeedRequestTarget } from './registry-auth-proxy-public-request';
import type { RegistryAuthProxyConfig, RegistryAuthProxyEnvironment } from './registry-auth-proxy.types';
import { verifyRegistryCredential } from './registry-credentials';
import type { RegistryCredentialPayload } from './registry-credentials.types';

const registryAuthProxyEnvironmentSchema: z.ZodTypeAny = z.object({
  COMPARTMENT_ARTIFACT_REGISTRY_PROXY_BIND_HOST: z.string().min(1),
  COMPARTMENT_ARTIFACT_REGISTRY_CREDENTIAL_SIGNING_KEY: z.string().min(32),
  COMPARTMENT_ARTIFACT_REGISTRY_PROXY_INTERNAL_PORT: z.coerce.number().int().positive().optional(),
  COMPARTMENT_ARTIFACT_REGISTRY_PROXY_PORT: z.coerce.number().int().positive(),
  COMPARTMENT_ARTIFACT_REGISTRY_PROXY_TARGET_URL: z.string().url(),
  COMPARTMENT_ARTIFACT_REGISTRY_TLS_CERTIFICATE_FILE: z.string().min(1).optional(),
  COMPARTMENT_ARTIFACT_REGISTRY_TLS_PRIVATE_KEY_FILE: z.string().min(1).optional(),
  COMPARTMENT_BUILDKIT_SEED_CACHE_PROXY_TARGET_URL: z.string().url(),
  COMPARTMENT_BUILDKIT_SEED_CACHE_REPOSITORY: z.string().refine(isRegistryRepositoryPath),
});

async function main(): Promise<void> {
  const config: RegistryAuthProxyConfig = readRegistryAuthProxyConfig(process.env);
  await listen(config);
}

function readRegistryAuthProxyConfig(env: NodeJS.ProcessEnv): RegistryAuthProxyConfig {
  const parsed: RegistryAuthProxyEnvironment = registryAuthProxyEnvironmentSchema.parse(
    env,
  ) as RegistryAuthProxyEnvironment;
  if (
    parsed.COMPARTMENT_ARTIFACT_REGISTRY_PROXY_INTERNAL_PORT !== undefined &&
    (parsed.COMPARTMENT_ARTIFACT_REGISTRY_TLS_CERTIFICATE_FILE === undefined ||
      parsed.COMPARTMENT_ARTIFACT_REGISTRY_TLS_PRIVATE_KEY_FILE === undefined)
  ) {
    throw new Error('Registry external TLS certificate and private key files are required.');
  }

  return {
    bindHost: parsed.COMPARTMENT_ARTIFACT_REGISTRY_PROXY_BIND_HOST,
    buildKitSeedCacheRepository: parsed.COMPARTMENT_BUILDKIT_SEED_CACHE_REPOSITORY,
    buildKitSeedCacheTargetUrl: new URL(parsed.COMPARTMENT_BUILDKIT_SEED_CACHE_PROXY_TARGET_URL),
    credentialSigningKey: parsed.COMPARTMENT_ARTIFACT_REGISTRY_CREDENTIAL_SIGNING_KEY,
    internalPort: parsed.COMPARTMENT_ARTIFACT_REGISTRY_PROXY_INTERNAL_PORT,
    port: parsed.COMPARTMENT_ARTIFACT_REGISTRY_PROXY_PORT,
    targetUrl: new URL(parsed.COMPARTMENT_ARTIFACT_REGISTRY_PROXY_TARGET_URL),
    tlsCertificateFile: parsed.COMPARTMENT_ARTIFACT_REGISTRY_TLS_CERTIFICATE_FILE,
    tlsPrivateKeyFile: parsed.COMPARTMENT_ARTIFACT_REGISTRY_TLS_PRIVATE_KEY_FILE,
  };
}

async function listen(config: RegistryAuthProxyConfig): Promise<void> {
  await listenServer(createRegistryAuthProxyServer(config, true), config.port, config.bindHost);
  if (config.internalPort !== undefined) {
    await listenServer(createRegistryAuthProxyServer(config, false), config.internalPort, config.bindHost);
  }
}

async function listenServer(server: Server, port: number, host: string): Promise<void> {
  await new Promise<void>((resolve: () => void): void => {
    server.listen(port, host, resolve);
  });
}

function createRegistryAuthProxyServer(config: RegistryAuthProxyConfig, nodeFacing: boolean): Server {
  const requestHandler: (request: IncomingMessage, response: ServerResponse) => void = (
    request: IncomingMessage,
    response: ServerResponse,
  ): void => {
    handleRegistryAuthProxyRequest(config, nodeFacing, request, response);
  };
  const server: Server =
    nodeFacing && config.tlsCertificateFile !== undefined && config.tlsPrivateKeyFile !== undefined
      ? createHttpsServer(
          {
            cert: readFileSync(config.tlsCertificateFile),
            key: readFileSync(config.tlsPrivateKeyFile),
          },
          requestHandler,
        )
      : createServer(requestHandler);

  server.on('connect', (request: IncomingMessage, socket: Duplex): void => {
    handleRegistryAuthProxyConnect(config, request, socket);
  });

  return server;
}

function handleRegistryAuthProxyRequest(
  config: RegistryAuthProxyConfig,
  allowPublicSeedPull: boolean,
  clientRequest: IncomingMessage,
  clientResponse: ServerResponse,
): void {
  const requestTarget: string | null = parseOriginFormRequestTarget(clientRequest.url);
  if (requestTarget === null) {
    sendBadRequest(clientResponse);
    return;
  }
  if (allowPublicSeedPull && tryProxyPublicBuildKitSeedRequest(config, requestTarget, clientRequest, clientResponse)) {
    return;
  }
  const credential: RegistryCredentialPayload | null = verifyRegistryCredential(
    config.credentialSigningKey,
    clientRequest.headers.authorization,
  );
  if (credential === null) {
    sendUnauthorized(clientResponse);
    return;
  }
  proxyAuthorizedRegistryRequest(config, credential, requestTarget, clientRequest, clientResponse);
}

function tryProxyPublicBuildKitSeedRequest(
  config: RegistryAuthProxyConfig,
  requestTarget: string,
  clientRequest: IncomingMessage,
  clientResponse: ServerResponse,
): boolean {
  const publicSeedTarget: string | null = resolvePublicBuildKitSeedRequestTarget(
    config.buildKitSeedCacheRepository,
    clientRequest.method,
    requestTarget,
  );
  if (publicSeedTarget === null) {
    return false;
  }
  if (publicSeedTarget === '/v2/') {
    clientResponse.writeHead(200, { 'Docker-Distribution-Api-Version': 'registry/2.0' });
    clientResponse.end();
  } else {
    proxyRegistryRequest(config, config.buildKitSeedCacheTargetUrl, publicSeedTarget, clientRequest, clientResponse);
  }
  return true;
}

function proxyAuthorizedRegistryRequest(
  config: RegistryAuthProxyConfig,
  credential: RegistryCredentialPayload,
  requestTarget: string,
  clientRequest: IncomingMessage,
  clientResponse: ServerResponse,
): void {
  const authorizedTarget: string | null = resolveAuthorizedRegistryRequestTarget(
    credential,
    clientRequest.method,
    requestTarget,
  );
  if (authorizedTarget === null) {
    sendForbidden(clientResponse);
    return;
  }
  proxyRegistryRequest(config, config.targetUrl, authorizedTarget, clientRequest, clientResponse);
}

function handleRegistryAuthProxyConnect(
  config: RegistryAuthProxyConfig,
  clientRequest: IncomingMessage,
  clientSocket: Duplex,
): void {
  if (verifyRegistryCredential(config.credentialSigningKey, clientRequest.headers.authorization) === null) {
    writeRawUnauthorized(clientSocket);
    return;
  }

  writeRawBadRequest(clientSocket);
}

function parseOriginFormRequestTarget(requestTarget: string | undefined): string | null {
  if (requestTarget === undefined || !requestTarget.startsWith('/') || requestTarget.startsWith('//')) {
    return null;
  }

  return requestTarget;
}

function proxyRegistryRequest(
  config: RegistryAuthProxyConfig,
  targetUrl: URL,
  requestTarget: string,
  clientRequest: IncomingMessage,
  clientResponse: ServerResponse,
): void {
  const registryRequest: ClientRequest = createHttpRequest(
    buildRegistryRequestOptions(clientRequest, targetUrl, requestTarget),
    (registryResponse: IncomingMessage): void => {
      pipeRegistryResponse(registryResponse, targetUrl, clientResponse);
    },
  );

  registryRequest.on('error', (): void => failRegistryProxyResponse(clientResponse));
  clientRequest.pipe(registryRequest);
}

function buildRegistryRequestOptions(
  clientRequest: IncomingMessage,
  targetUrl: URL,
  requestTarget: string,
): RequestOptions {
  return {
    headers: buildProxyRequestHeaders(clientRequest, targetUrl),
    hostname: targetUrl.hostname,
    method: clientRequest.method,
    path: requestTarget,
    port: targetUrl.port,
    protocol: targetUrl.protocol,
  };
}

function pipeRegistryResponse(registryResponse: IncomingMessage, targetUrl: URL, clientResponse: ServerResponse): void {
  clientResponse.writeHead(registryResponse.statusCode ?? 502, buildProxyResponseHeaders(registryResponse, targetUrl));
  pipeline(registryResponse, clientResponse, (error: NodeJS.ErrnoException | null): void => {
    if (error !== null && !clientResponse.destroyed) {
      clientResponse.destroy(error);
    }
  });
}

function failRegistryProxyResponse(clientResponse: ServerResponse): void {
  if (clientResponse.headersSent) {
    clientResponse.destroy();
    return;
  }
  clientResponse.writeHead(502, { 'Content-Type': 'application/json' });
  clientResponse.end('{"error":"registry_proxy_failed","message":"Registry proxy request failed."}\n');
}

if (require.main === module) {
  void main();
}
