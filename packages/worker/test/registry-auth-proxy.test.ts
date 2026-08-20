import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createConnection, type AddressInfo, type Socket } from 'node:net';
import { resolve as resolvePath } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { rewriteRegistryLocationHeader } from '../src/registry-auth-proxy-location';
import { issueBuildPushCredential, issueProjectPullCredential } from '../src/registry-credentials';
import type { RegistryCredential } from '../src/registry-credentials.types';

const signingKey: string = 'registry-signing-key-with-at-least-32-characters';
const projectRepository: string = 'projects/prj_123/services/svc_123';
const buildKitSeedRepository: string = 'compartmentdev/compartment-buildkit-seed';
const buildKitSeedDigest: string = `sha256:${'a'.repeat(64)}`;
const pullCredential: RegistryCredential = issueProjectPullCredential(signingKey, 'prj_123');
const pushCredential: RegistryCredential = issueBuildPushCredential(
  signingKey,
  'prj_123',
  projectRepository,
  'art_123',
);

interface RegistryTargetCall {
  authorization: string | undefined;
  host: string | undefined;
  method: string | undefined;
  url: string | undefined;
}

interface RawHttpResponse {
  body: string;
  statusCode: number;
  statusLine: string;
}

interface RegistryFetchResponse {
  location: string | null;
  status: number;
}

interface RegistryLocationPolicyCase {
  createLocation: (targetUrl: string) => string;
  expectedLocation: string | null;
  name: string;
}

describe('registry auth proxy', (): void => {
  const processes: ChildProcessWithoutNullStreams[] = [];
  const servers: Server[] = [];

  afterEach(async (): Promise<void> => {
    while (processes.length > 0) {
      await stopProcess(processes.pop()!);
    }
    while (servers.length > 0) {
      await closeServer(servers.pop()!);
    }
  });

  it('requires read or write credentials for local registry access and strips auth before proxying', async (): Promise<void> => {
    const targetCalls: RegistryTargetCall[] = [];
    const targetServer: Server = await listen(
      createServer((request: IncomingMessage, response: ServerResponse): void => {
        targetCalls.push({
          authorization: request.headers.authorization,
          host: request.headers.host,
          method: request.method,
          url: request.url,
        });
        response.statusCode = request.method === 'DELETE' ? 202 : 200;
        response.end('registry-ok');
      }),
    );
    servers.push(targetServer);
    const proxyPort: number = await readAvailablePort();
    const proxyProcess: ChildProcessWithoutNullStreams = await startProxyProcess(
      readServerUrl(targetServer),
      proxyPort,
    );
    processes.push(proxyProcess);
    const proxyUrl: string = `http://127.0.0.1:${proxyPort.toString()}`;
    const targetHost: string = new URL(readServerUrl(targetServer)).host;

    await expect(readStatus(`${proxyUrl}/v2/${projectRepository}/manifests/art_123`)).resolves.toBe(401);
    await expect(
      readStatus(`${proxyUrl}/v2/projects/prj_other/services/svc_123/manifests/art_123`, {
        headers: {
          authorization: credentialAuthorizationHeader(pullCredential),
        },
      }),
    ).resolves.toBe(403);
    await expect(
      readStatus(
        `${proxyUrl}/v2/projects/prj_other/services/svc_other/blobs/uploads/?mount=sha256%3Aabc&from=${encodeURIComponent(projectRepository)}`,
        {
          headers: { authorization: credentialAuthorizationHeader(pushCredential) },
          method: 'POST',
        },
      ),
    ).resolves.toBe(403);
    await expect(
      readRawHttpResponse(proxyPort, [
        'POST /v2/projects/prj_other/services/svc_other/blobs/uploads/../../../../../prj_123/services/svc_123/blobs/uploads/?mount=sha256%3Aabc&from=projects%2Fprj_other%2Fservices%2Fsvc_other HTTP/1.1',
        'Host: untrusted.registry-client.test',
        `Authorization: ${credentialAuthorizationHeader(pushCredential)}`,
        'Content-Length: 0',
        'Connection: close',
      ]),
    ).resolves.toMatchObject({
      statusCode: 403,
    });
    await expect(
      readStatus(`${proxyUrl}/v2/${projectRepository}/manifests/art_123`, {
        headers: { authorization: credentialAuthorizationHeader(pullCredential) },
      }),
    ).resolves.toBe(200);
    await expect(
      readRawHttpResponse(proxyPort, [
        `GET /v2/${projectRepository}/manifests/art_123 HTTP/1.1`,
        'Host: untrusted.registry-client.test',
        `Authorization: ${credentialAuthorizationHeader(pullCredential)}`,
        'Connection: close',
      ]),
    ).resolves.toMatchObject({
      body: 'registry-ok',
      statusCode: 200,
    });
    await expect(
      readStatus(`${proxyUrl}/v2/${projectRepository}/manifests/art_123`, {
        headers: {
          authorization: credentialAuthorizationHeader(pullCredential),
        },
        method: 'PUT',
      }),
    ).resolves.toBe(403);
    await expect(
      readStatus(`${proxyUrl}/v2/${projectRepository}/manifests/art_123`, {
        headers: {
          authorization: credentialAuthorizationHeader(pushCredential),
        },
        method: 'PUT',
      }),
    ).resolves.toBe(200);
    await expect(
      readStatus(
        `${proxyUrl}/v2/${projectRepository}/blobs/uploads/?mount=sha256%3Aabc&from=projects%2Fprj_other%2Fservices%2Fsvc_other`,
        {
          headers: { authorization: credentialAuthorizationHeader(pushCredential) },
          method: 'POST',
        },
      ),
    ).resolves.toBe(200);

    expect(targetCalls).toEqual([
      {
        authorization: undefined,
        host: targetHost,
        method: 'GET',
        url: `/v2/${projectRepository}/manifests/art_123`,
      },
      {
        authorization: undefined,
        host: targetHost,
        method: 'GET',
        url: `/v2/${projectRepository}/manifests/art_123`,
      },
      {
        authorization: undefined,
        host: targetHost,
        method: 'PUT',
        url: `/v2/${projectRepository}/manifests/art_123`,
      },
      {
        authorization: undefined,
        host: targetHost,
        method: 'POST',
        url: `/v2/${projectRepository}/blobs/uploads/`,
      },
    ]);
  });

  it('proxies only anonymous digest pulls for the configured BuildKit seed repository', async (): Promise<void> => {
    const registryCalls: RegistryTargetCall[] = [];
    const seedCacheCalls: RegistryTargetCall[] = [];
    const registryServer: Server = await listen(requestRecorderServer(registryCalls, 'registry-ok'));
    const seedCacheServer: Server = await listen(requestRecorderServer(seedCacheCalls, 'seed-cache-ok'));
    servers.push(registryServer, seedCacheServer);
    const proxyPort: number = await readAvailablePort();
    const proxyProcess: ChildProcessWithoutNullStreams = await startProxyProcess(
      readServerUrl(registryServer),
      proxyPort,
      readServerUrl(seedCacheServer),
    );
    processes.push(proxyProcess);
    const proxyUrl: string = `http://127.0.0.1:${proxyPort.toString()}`;

    await expect(readStatus(`${proxyUrl}/v2/${buildKitSeedRepository}/manifests/${buildKitSeedDigest}`)).resolves.toBe(
      200,
    );
    await expect(
      readStatus(`${proxyUrl}/v2/${buildKitSeedRepository}/blobs/${buildKitSeedDigest}`, { method: 'HEAD' }),
    ).resolves.toBe(200);
    await expect(readStatus(`${proxyUrl}/v2/${buildKitSeedRepository}/manifests/latest`)).resolves.toBe(401);
    await expect(readStatus(`${proxyUrl}/v2/other/seed/manifests/${buildKitSeedDigest}`)).resolves.toBe(401);
    await expect(
      readStatus(`${proxyUrl}/v2/${buildKitSeedRepository}/manifests/${buildKitSeedDigest}`, { method: 'PUT' }),
    ).resolves.toBe(401);

    expect(registryCalls).toEqual([]);
    expect(
      seedCacheCalls.map(
        (call: RegistryTargetCall): Pick<RegistryTargetCall, 'method' | 'url'> => ({
          method: call.method,
          url: call.url,
        }),
      ),
    ).toEqual([
      { method: 'GET', url: `/v2/${buildKitSeedRepository}/manifests/${buildKitSeedDigest}` },
      { method: 'HEAD', url: `/v2/${buildKitSeedRepository}/blobs/${buildKitSeedDigest}` },
    ]);
  });

  it('survives an upstream seed blob response abort', async (): Promise<void> => {
    const registryServer: Server = await listen(requestRecorderServer([], 'registry-ok'));
    const seedCacheServer: Server = await listen(
      createServer((_request: IncomingMessage, response: ServerResponse): void => {
        response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        response.write('partial-blob');
        response.destroy();
      }),
    );
    servers.push(registryServer, seedCacheServer);
    const proxyPort: number = await readAvailablePort();
    const proxyProcess: ChildProcessWithoutNullStreams = await startProxyProcess(
      readServerUrl(registryServer),
      proxyPort,
      readServerUrl(seedCacheServer),
    );
    processes.push(proxyProcess);

    await expect(
      readStatus(`http://127.0.0.1:${proxyPort.toString()}/v2/${buildKitSeedRepository}/blobs/${buildKitSeedDigest}`),
    ).resolves.toBe(502);
    await expect(readStatus(`http://127.0.0.1:${proxyPort.toString()}/v2/`)).resolves.toBe(200);
    expect(proxyProcess.exitCode).toBeNull();
  });

  it('rejects authenticated non-origin-form request targets without proxying', async (): Promise<void> => {
    const targetCalls: RegistryTargetCall[] = [];
    const internalCalls: RegistryTargetCall[] = [];
    const targetServer: Server = await listen(
      createServer((request: IncomingMessage, response: ServerResponse): void => {
        targetCalls.push({
          authorization: request.headers.authorization,
          host: request.headers.host,
          method: request.method,
          url: request.url,
        });
        response.end('configured-registry');
      }),
    );
    const internalServer: Server = await listen(
      createServer((request: IncomingMessage, response: ServerResponse): void => {
        internalCalls.push({
          authorization: request.headers.authorization,
          host: request.headers.host,
          method: request.method,
          url: request.url,
        });
        response.end('internal-service');
      }),
    );
    servers.push(targetServer, internalServer);
    const proxyPort: number = await readAvailablePort();
    const proxyProcess: ChildProcessWithoutNullStreams = await startProxyProcess(
      readServerUrl(targetServer),
      proxyPort,
    );
    processes.push(proxyProcess);
    const internalUrl: string = readServerUrl(internalServer);
    const internalPort: number = readServerPort(internalServer);
    const authorization: string = credentialAuthorizationHeader(pullCredential);

    await expect(
      readRawHttpResponse(proxyPort, [
        `GET ${internalUrl}/admin HTTP/1.1`,
        `Host: 127.0.0.1:${proxyPort.toString()}`,
        `Authorization: ${authorization}`,
        'Connection: close',
      ]),
    ).resolves.toMatchObject({
      body: '{"error":"registry_bad_request","message":"Invalid registry proxy request."}\n',
      statusCode: 400,
    });
    await expect(
      readRawHttpResponse(proxyPort, [
        `GET //127.0.0.1:${internalPort.toString()}/admin HTTP/1.1`,
        `Host: 127.0.0.1:${proxyPort.toString()}`,
        `Authorization: ${authorization}`,
        'Connection: close',
      ]),
    ).resolves.toMatchObject({
      body: '{"error":"registry_bad_request","message":"Invalid registry proxy request."}\n',
      statusCode: 400,
    });
    await expect(
      readRawHttpResponse(proxyPort, [
        `CONNECT 127.0.0.1:${internalPort.toString()} HTTP/1.1`,
        `Host: 127.0.0.1:${proxyPort.toString()}`,
        `Authorization: ${authorization}`,
        'Connection: close',
      ]),
    ).resolves.toMatchObject({
      body: '{"error":"registry_bad_request","message":"Invalid registry proxy request."}\n',
      statusCode: 400,
    });

    expect(targetCalls).toEqual([]);
    expect(internalCalls).toEqual([]);
  });

  it('applies strict registry-owned Location policy to proxied responses', async (): Promise<void> => {
    const uploadPath: string = `/v2/${projectRepository}/blobs/uploads/upload-id`;
    const locationPolicyCases: RegistryLocationPolicyCase[] = [
      {
        createLocation: (targetUrl: string): string => `${targetUrl}${uploadPath}`,
        expectedLocation: uploadPath,
        name: 'target-origin absolute registry upload redirect',
      },
      {
        createLocation: (): string => uploadPath,
        expectedLocation: uploadPath,
        name: 'safe origin-form registry upload redirect',
      },
      {
        createLocation: (targetUrl: string): string => `${targetUrl}@evil.example${uploadPath}`,
        expectedLocation: null,
        name: 'prefix-confusion userinfo absolute URL',
      },
      {
        createLocation: (): string => `http://evil.example${uploadPath}`,
        expectedLocation: null,
        name: 'cross-origin absolute URL',
      },
      {
        createLocation: (): string => `//evil.example${uploadPath}`,
        expectedLocation: null,
        name: 'network-path URL',
      },
      {
        createLocation: (): string => 'http://[::1',
        expectedLocation: null,
        name: 'malformed URL',
      },
    ];
    let targetUrl: string = '';
    let targetLocation: string = '';
    const targetServer: Server = await listen(
      createServer((_request: IncomingMessage, response: ServerResponse): void => {
        response.writeHead(307, {
          location: targetLocation,
        });
        response.end();
      }),
    );
    targetUrl = readServerUrl(targetServer);
    servers.push(targetServer);
    const proxyPort: number = await readAvailablePort();
    const proxyProcess: ChildProcessWithoutNullStreams = await startProxyProcess(targetUrl, proxyPort);
    processes.push(proxyProcess);
    const proxyUrl: string = `http://127.0.0.1:${proxyPort.toString()}`;

    for (const locationPolicyCase of locationPolicyCases) {
      targetLocation = locationPolicyCase.createLocation(targetUrl);

      await expect(
        readFetchResponse(`${proxyUrl}/v2/${projectRepository}/blobs/uploads/`, {
          headers: {
            authorization: credentialAuthorizationHeader(pushCredential),
          },
          method: 'POST',
          redirect: 'manual',
        }),
        locationPolicyCase.name,
      ).resolves.toEqual({
        location: locationPolicyCase.expectedLocation,
        status: 307,
      });
    }
  });

  it('rejects unsafe registry Location values before rewrite', (): void => {
    const targetUrl: URL = new URL('http://registry.example:5000');
    const unsafeLocations: string[] = [
      'http://user:password@registry.example:5000/v2/repo/blobs/uploads/upload-id',
      'http://@registry.example:5000/v2/repo/blobs/uploads/upload-id',
      'http://registry.example:5000.evil/v2/repo/blobs/uploads/upload-id',
      'http:registry.example:5000/v2/repo/blobs/uploads/upload-id',
      'http://registry.example:5000/v1/%2e%2e/v2/repo/blobs/uploads/upload-id',
      'http://registry.example:5000/x/../v2/repo/blobs/uploads/upload-id',
      '/v2/repo\r\nx',
      '/v2/repo\u007f',
      '/v2/repo\u0085',
      '/v2/%zz',
      '/v1/%2e%2e/v2/repo/blobs/uploads/upload-id',
      '/x/../v2/repo/blobs/uploads/upload-id',
    ];

    for (const unsafeLocation of unsafeLocations) {
      expect(rewriteRegistryLocationHeader(unsafeLocation, targetUrl), unsafeLocation).toBeNull();
    }
  });
});

async function startProxyProcess(
  targetUrl: string,
  proxyPort: number,
  seedCacheTargetUrl: string = targetUrl,
): Promise<ChildProcessWithoutNullStreams> {
  const stderrChunks: string[] = [];
  const workerPackageDirectory: string = resolvePath(__dirname, '..');
  const proxyScriptPath: string = resolvePath(workerPackageDirectory, 'src/registry-auth-proxy.ts');
  const child: ChildProcessWithoutNullStreams = spawn('pnpm', ['exec', 'tsx', proxyScriptPath], {
    cwd: workerPackageDirectory,
    env: createProxyEnvironment(targetUrl, proxyPort, seedCacheTargetUrl),
  });
  child.stderr.on('data', (chunk: Buffer): void => {
    stderrChunks.push(chunk.toString('utf8'));
  });
  await waitForProxyReady(`http://127.0.0.1:${proxyPort.toString()}/v2/`, child, stderrChunks);

  return child;
}

function createProxyEnvironment(targetUrl: string, proxyPort: number, seedCacheTargetUrl: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    COMPARTMENT_ARTIFACT_REGISTRY_PROXY_BIND_HOST: '127.0.0.1',
    COMPARTMENT_ARTIFACT_REGISTRY_CREDENTIAL_SIGNING_KEY: signingKey,
    COMPARTMENT_ARTIFACT_REGISTRY_PROXY_PORT: proxyPort.toString(),
    COMPARTMENT_ARTIFACT_REGISTRY_PROXY_TARGET_URL: targetUrl,
    COMPARTMENT_BUILDKIT_SEED_CACHE_PROXY_TARGET_URL: seedCacheTargetUrl,
    COMPARTMENT_BUILDKIT_SEED_CACHE_REPOSITORY: buildKitSeedRepository,
  };
}

async function waitForProxyReady(
  url: string,
  child: ChildProcessWithoutNullStreams,
  stderrChunks: string[],
): Promise<void> {
  for (let attempt: number = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Registry auth proxy exited before listening.\n${stderrChunks.join('')}`);
    }
    if (await canReadProxyUnauthorizedStatus(url)) {
      return;
    }
    await wait(50);
  }

  throw new Error(`Registry auth proxy did not become ready.\n${stderrChunks.join('')}`);
}

async function canReadProxyUnauthorizedStatus(url: string): Promise<boolean> {
  try {
    return (await readStatus(url)) === 200;
  } catch {
    return false;
  }
}

function requestRecorderServer(calls: RegistryTargetCall[], body: string): Server {
  return createServer((request: IncomingMessage, response: ServerResponse): void => {
    calls.push({
      authorization: request.headers.authorization,
      host: request.headers.host,
      method: request.method,
      url: request.url,
    });
    response.end(body);
  });
}

async function readStatus(url: string, init?: RequestInit): Promise<number> {
  const response: Response = await fetch(url, init);
  await response.arrayBuffer();
  return response.status;
}

async function readFetchResponse(url: string, init?: RequestInit): Promise<RegistryFetchResponse> {
  const response: Response = await fetch(url, init);
  await response.arrayBuffer();
  return {
    location: response.headers.get('location'),
    status: response.status,
  };
}

async function readRawHttpResponse(port: number, requestLines: string[]): Promise<RawHttpResponse> {
  const responseText: string = await readRawHttpResponseText(port, requestLines);
  const [head = '', body = ''] = responseText.split('\r\n\r\n');
  const [statusLine = ''] = head.split('\r\n');
  const [, statusCode = '0'] = /^HTTP\/\d\.\d\s+(\d+)/.exec(statusLine) ?? [];

  return {
    body,
    statusCode: Number(statusCode),
    statusLine,
  };
}

async function readRawHttpResponseText(port: number, requestLines: string[]): Promise<string> {
  return await new Promise<string>((resolve: (value: string) => void, reject: (reason?: Error) => void): void => {
    const chunks: string[] = [];
    const socket: Socket = createConnection({ host: '127.0.0.1', port }, (): void => {
      socket.write(`${requestLines.join('\r\n')}\r\n\r\n`);
    });
    socket.setEncoding('utf8');
    socket.setTimeout(2_000);
    socket.on('data', (chunk: string): void => {
      chunks.push(chunk);
    });
    socket.on('end', (): void => {
      resolve(chunks.join(''));
    });
    socket.on('error', reject);
    socket.on('timeout', (): void => {
      socket.destroy(new Error('Timed out waiting for raw HTTP response.'));
    });
  });
}

function credentialAuthorizationHeader(credential: RegistryCredential): string {
  return `Basic ${Buffer.from(`${credential.username}:${credential.password}`, 'utf8').toString('base64')}`;
}

async function listen(server: Server): Promise<Server> {
  await new Promise<void>((resolve: () => void, reject: (reason?: Error) => void): void => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', (): void => {
      server.off('error', reject);
      resolve();
    });
  });

  return server;
}

async function readAvailablePort(): Promise<number> {
  const server: Server = await listen(createServer());
  const address: AddressInfo | string | null = server.address();
  await closeServer(server);
  if (address === null || typeof address === 'string') {
    throw new Error('Expected temporary server to listen on TCP.');
  }

  return address.port;
}

function readServerUrl(server: Server): string {
  return `http://127.0.0.1:${readServerPort(server).toString()}`;
}

function readServerPort(server: Server): number {
  const address: AddressInfo | string | null = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected registry auth proxy test server to listen on TCP.');
  }

  return address.port;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve: () => void, reject: (reason?: Error) => void): void => {
    server.close((error?: Error): void => {
      if (error === undefined) {
        resolve();
        return;
      }
      reject(error);
    });
  });
}

async function stopProcess(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }
  child.kill('SIGTERM');
  await new Promise<void>((resolve: () => void): void => {
    child.once('exit', (): void => {
      resolve();
    });
  });
}

async function wait(ms: number): Promise<void> {
  await new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, ms);
  });
}
