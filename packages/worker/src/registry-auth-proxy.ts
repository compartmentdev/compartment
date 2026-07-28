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
import type { Duplex } from 'node:stream';
import { z } from 'zod';
import {
  sendBadRequest,
  sendForbidden,
  sendUnauthorized,
  writeRawBadRequest,
  writeRawUnauthorized,
} from './registry-auth-proxy-responses';
import { rewriteRegistryLocationHeader } from './registry-auth-proxy-location';
import { resolveAuthorizedRegistryRequestTarget } from './registry-auth-proxy-request';
import { verifyRegistryCredential } from './registry-credentials';
import type { RegistryCredentialPayload } from './registry-credentials.types';

interface RegistryAuthProxyConfig {
  bindHost: string;
  credentialSigningKey: string;
  internalPort?: number | undefined;
  port: number;
  targetUrl: URL;
  tlsCertificateFile?: string | undefined;
  tlsPrivateKeyFile?: string | undefined;
}

interface RegistryAuthProxyEnvironment {
  COMPARTMENT_ARTIFACT_REGISTRY_PROXY_BIND_HOST: string;
  COMPARTMENT_ARTIFACT_REGISTRY_CREDENTIAL_SIGNING_KEY: string;
  COMPARTMENT_ARTIFACT_REGISTRY_PROXY_INTERNAL_PORT?: number | undefined;
  COMPARTMENT_ARTIFACT_REGISTRY_PROXY_PORT: number;
  COMPARTMENT_ARTIFACT_REGISTRY_PROXY_TARGET_URL: string;
  COMPARTMENT_ARTIFACT_REGISTRY_TLS_CERTIFICATE_FILE?: string | undefined;
  COMPARTMENT_ARTIFACT_REGISTRY_TLS_PRIVATE_KEY_FILE?: string | undefined;
}

const registryAuthProxyEnvironmentSchema: z.ZodTypeAny = z.object({
  COMPARTMENT_ARTIFACT_REGISTRY_PROXY_BIND_HOST: z.string().min(1),
  COMPARTMENT_ARTIFACT_REGISTRY_CREDENTIAL_SIGNING_KEY: z.string().min(32),
  COMPARTMENT_ARTIFACT_REGISTRY_PROXY_INTERNAL_PORT: z.coerce.number().int().positive().optional(),
  COMPARTMENT_ARTIFACT_REGISTRY_PROXY_PORT: z.coerce.number().int().positive(),
  COMPARTMENT_ARTIFACT_REGISTRY_PROXY_TARGET_URL: z.string().url(),
  COMPARTMENT_ARTIFACT_REGISTRY_TLS_CERTIFICATE_FILE: z.string().min(1).optional(),
  COMPARTMENT_ARTIFACT_REGISTRY_TLS_PRIVATE_KEY_FILE: z.string().min(1).optional(),
});

const hopByHopHeaderNames: ReadonlySet<string> = new Set<string>([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

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

function createRegistryAuthProxyServer(config: RegistryAuthProxyConfig, enableTls: boolean): Server {
  const requestHandler: (request: IncomingMessage, response: ServerResponse) => void = (
    request: IncomingMessage,
    response: ServerResponse,
  ): void => {
    handleRegistryAuthProxyRequest(config, request, response);
  };
  const server: Server =
    enableTls && config.tlsCertificateFile !== undefined && config.tlsPrivateKeyFile !== undefined
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
  clientRequest: IncomingMessage,
  clientResponse: ServerResponse,
): void {
  const credential: RegistryCredentialPayload | null = verifyRegistryCredential(
    config.credentialSigningKey,
    clientRequest.headers.authorization,
  );
  if (credential === null) {
    sendUnauthorized(clientResponse);
    return;
  }
  const requestTarget: string | null = parseOriginFormRequestTarget(clientRequest.url);
  if (requestTarget === null) {
    sendBadRequest(clientResponse);
    return;
  }
  proxyAuthorizedRegistryRequest(config, credential, requestTarget, clientRequest, clientResponse);
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
  proxyRegistryRequest(config, authorizedTarget, clientRequest, clientResponse);
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
  requestTarget: string,
  clientRequest: IncomingMessage,
  clientResponse: ServerResponse,
): void {
  const registryRequest: ClientRequest = createHttpRequest(
    buildRegistryRequestOptions(clientRequest, config.targetUrl, requestTarget),
    (registryResponse: IncomingMessage): void => {
      pipeRegistryResponse(registryResponse, config, clientResponse);
    },
  );

  registryRequest.on('error', (): void => {
    clientResponse.writeHead(502, { 'Content-Type': 'application/json' });
    clientResponse.end('{"error":"registry_proxy_failed","message":"Registry proxy request failed."}\n');
  });
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

function pipeRegistryResponse(
  registryResponse: IncomingMessage,
  config: RegistryAuthProxyConfig,
  clientResponse: ServerResponse,
): void {
  clientResponse.writeHead(
    registryResponse.statusCode ?? 502,
    buildProxyResponseHeaders(registryResponse, config.targetUrl),
  );
  registryResponse.pipe(clientResponse);
}

function buildProxyRequestHeaders(request: IncomingMessage, targetUrl: URL): Record<string, string | string[]> {
  return {
    ...filterProxyHeaders(request.headers),
    host: targetUrl.host,
  };
}

function buildProxyResponseHeaders(response: IncomingMessage, targetUrl: URL): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = filterProxyHeaders(response.headers);
  const location: string | string[] | undefined = headers.location;
  if (location !== undefined) {
    const rewrittenLocation: string | null =
      typeof location === 'string' ? rewriteRegistryLocationHeader(location, targetUrl) : null;
    if (rewrittenLocation === null) {
      delete headers.location;
    } else {
      headers.location = rewrittenLocation;
    }
  }

  return headers;
}

function filterProxyHeaders(headers: NodeJS.Dict<string | string[]>): Record<string, string | string[]> {
  const filteredHeaders: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined && !hopByHopHeaderNames.has(name.toLowerCase()) && name.toLowerCase() !== 'authorization') {
      filteredHeaders[name] = value;
    }
  }

  return filteredHeaders;
}

if (require.main === module) {
  void main();
}
