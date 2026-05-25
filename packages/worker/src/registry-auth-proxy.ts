import {
  createServer,
  request as createHttpRequest,
  type ClientRequest,
  type IncomingMessage,
  type RequestOptions,
  type Server,
  type ServerResponse,
} from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { Duplex } from 'node:stream';
import { z } from 'zod';
import {
  sendBadRequest,
  sendUnauthorized,
  writeRawBadRequest,
  writeRawUnauthorized,
} from './registry-auth-proxy-responses';

interface RegistryAuthCredentials {
  password: string;
  username: string;
}

interface RegistryAuthProxyConfig {
  bindHost: string;
  port: number;
  readCredentials: RegistryAuthCredentials;
  targetUrl: URL;
  writeCredentials: RegistryAuthCredentials;
}

interface RegistryAuthProxyEnvironment {
  COMPARTMENT_ARTIFACT_REGISTRY_PROXY_BIND_HOST: string;
  COMPARTMENT_ARTIFACT_REGISTRY_PROXY_PORT: number;
  COMPARTMENT_ARTIFACT_REGISTRY_PROXY_TARGET_URL: string;
  COMPARTMENT_ARTIFACT_REGISTRY_READ_PASSWORD: string;
  COMPARTMENT_ARTIFACT_REGISTRY_READ_USERNAME: string;
  COMPARTMENT_ARTIFACT_REGISTRY_WRITE_PASSWORD: string;
  COMPARTMENT_ARTIFACT_REGISTRY_WRITE_USERNAME: string;
}

interface ParsedBasicAuthorization {
  password: string;
  username: string;
}

const registryAuthProxyEnvironmentSchema: z.ZodTypeAny = z.object({
  COMPARTMENT_ARTIFACT_REGISTRY_PROXY_BIND_HOST: z.string().min(1),
  COMPARTMENT_ARTIFACT_REGISTRY_PROXY_PORT: z.coerce.number().int().positive(),
  COMPARTMENT_ARTIFACT_REGISTRY_PROXY_TARGET_URL: z.string().url(),
  COMPARTMENT_ARTIFACT_REGISTRY_READ_PASSWORD: z.string().min(1),
  COMPARTMENT_ARTIFACT_REGISTRY_READ_USERNAME: z.string().min(1),
  COMPARTMENT_ARTIFACT_REGISTRY_WRITE_PASSWORD: z.string().min(1),
  COMPARTMENT_ARTIFACT_REGISTRY_WRITE_USERNAME: z.string().min(1),
});

const writeMethods: ReadonlySet<string> = new Set<string>(['DELETE', 'PATCH', 'POST', 'PUT']);
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

  return {
    bindHost: parsed.COMPARTMENT_ARTIFACT_REGISTRY_PROXY_BIND_HOST,
    port: parsed.COMPARTMENT_ARTIFACT_REGISTRY_PROXY_PORT,
    readCredentials: {
      password: parsed.COMPARTMENT_ARTIFACT_REGISTRY_READ_PASSWORD,
      username: parsed.COMPARTMENT_ARTIFACT_REGISTRY_READ_USERNAME,
    },
    targetUrl: new URL(parsed.COMPARTMENT_ARTIFACT_REGISTRY_PROXY_TARGET_URL),
    writeCredentials: {
      password: parsed.COMPARTMENT_ARTIFACT_REGISTRY_WRITE_PASSWORD,
      username: parsed.COMPARTMENT_ARTIFACT_REGISTRY_WRITE_USERNAME,
    },
  };
}

async function listen(config: RegistryAuthProxyConfig): Promise<void> {
  const server: Server = createRegistryAuthProxyServer(config);
  await new Promise<void>((resolve: () => void): void => {
    server.listen(config.port, config.bindHost, resolve);
  });
}

function createRegistryAuthProxyServer(config: RegistryAuthProxyConfig): Server {
  const server: Server = createServer((request: IncomingMessage, response: ServerResponse): void => {
    handleRegistryAuthProxyRequest(config, request, response);
  });

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
  if (!isAuthorizedRegistryRequest(config, clientRequest)) {
    sendUnauthorized(clientResponse);
    return;
  }

  const requestTarget: string | null = parseOriginFormRequestTarget(clientRequest.url);
  if (requestTarget === null) {
    sendBadRequest(clientResponse);
    return;
  }

  proxyRegistryRequest(config, requestTarget, clientRequest, clientResponse);
}

function handleRegistryAuthProxyConnect(
  config: RegistryAuthProxyConfig,
  clientRequest: IncomingMessage,
  clientSocket: Duplex,
): void {
  if (!isAuthorizedRegistryRequest(config, clientRequest)) {
    writeRawUnauthorized(clientSocket);
    return;
  }

  writeRawBadRequest(clientSocket);
}

function isAuthorizedRegistryRequest(config: RegistryAuthProxyConfig, request: IncomingMessage): boolean {
  const authorization: ParsedBasicAuthorization | null = parseBasicAuthorization(request.headers.authorization);
  if (authorization === null) {
    return false;
  }

  if (matchesCredentials(authorization, config.writeCredentials)) {
    return true;
  }

  return !isWriteMethod(request.method) && matchesCredentials(authorization, config.readCredentials);
}

function parseBasicAuthorization(header: string | undefined): ParsedBasicAuthorization | null {
  const prefix: string = 'Basic ';
  if (header?.startsWith(prefix) !== true) {
    return null;
  }

  const decoded: string = Buffer.from(header.slice(prefix.length), 'base64').toString('utf8');
  const separatorIndex: number = decoded.indexOf(':');
  if (separatorIndex <= 0) {
    return null;
  }

  return {
    password: decoded.slice(separatorIndex + 1),
    username: decoded.slice(0, separatorIndex),
  };
}

function matchesCredentials(candidate: ParsedBasicAuthorization, expected: RegistryAuthCredentials): boolean {
  return (
    timingSafeEquals(candidate.username, expected.username) && timingSafeEquals(candidate.password, expected.password)
  );
}

function timingSafeEquals(left: string, right: string): boolean {
  const leftBuffer: Buffer = Buffer.from(left);
  const rightBuffer: Buffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function isWriteMethod(method: string | undefined): boolean {
  return method !== undefined && writeMethods.has(method.toUpperCase());
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
      pipeRegistryResponse(registryResponse, config, clientRequest, clientResponse);
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
  clientRequest: IncomingMessage,
  clientResponse: ServerResponse,
): void {
  clientResponse.writeHead(
    registryResponse.statusCode ?? 502,
    buildProxyResponseHeaders(registryResponse, config.targetUrl, clientRequest.headers.host),
  );
  registryResponse.pipe(clientResponse);
}

function buildProxyRequestHeaders(request: IncomingMessage, targetUrl: URL): Record<string, string | string[]> {
  return {
    ...filterProxyHeaders(request.headers),
    host: targetUrl.host,
  };
}

function buildProxyResponseHeaders(
  response: IncomingMessage,
  targetUrl: URL,
  requestHost: string | undefined,
): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = filterProxyHeaders(response.headers);
  const location: string | string[] | undefined = headers.location;
  if (typeof location === 'string' && requestHost !== undefined) {
    headers.location = rewriteRegistryLocation(location, targetUrl, requestHost);
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

function rewriteRegistryLocation(location: string, targetUrl: URL, requestHost: string): string {
  if (location.startsWith(targetUrl.origin)) {
    return `http://${requestHost}${location.slice(targetUrl.origin.length)}`;
  }

  return location;
}

if (require.main === module) {
  void main();
}
