import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createConnection, type AddressInfo, type Socket } from 'node:net';
import { resolve as resolvePath } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

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

    await expect(readStatus(`${proxyUrl}/v2/repo/manifests/latest`)).resolves.toBe(401);
    await expect(readStatus(`${proxyUrl}/v2/repo/manifests/latest`, { method: 'PUT' })).resolves.toBe(401);
    await expect(
      readStatus(`${proxyUrl}/v2/repo/manifests/latest`, {
        headers: {
          authorization: basicAuthorizationHeader('reader', 'read-password'),
        },
      }),
    ).resolves.toBe(200);
    await expect(
      readRawHttpResponse(proxyPort, [
        'GET /v2/repo/manifests/latest HTTP/1.1',
        'Host: untrusted.registry-client.test',
        `Authorization: ${basicAuthorizationHeader('reader', 'read-password')}`,
        'Connection: close',
      ]),
    ).resolves.toMatchObject({
      body: 'registry-ok',
      statusCode: 200,
    });
    await expect(
      readStatus(`${proxyUrl}/v2/repo/manifests/sha256:abc`, {
        headers: {
          authorization: basicAuthorizationHeader('reader', 'read-password'),
        },
        method: 'DELETE',
      }),
    ).resolves.toBe(401);
    await expect(
      readStatus(`${proxyUrl}/v2/repo/manifests/sha256:abc`, {
        headers: {
          authorization: basicAuthorizationHeader('writer', 'write-password'),
        },
        method: 'DELETE',
      }),
    ).resolves.toBe(202);

    expect(targetCalls).toEqual([
      {
        authorization: undefined,
        host: targetHost,
        method: 'GET',
        url: '/v2/repo/manifests/latest',
      },
      {
        authorization: undefined,
        host: targetHost,
        method: 'GET',
        url: '/v2/repo/manifests/latest',
      },
      {
        authorization: undefined,
        host: targetHost,
        method: 'DELETE',
        url: '/v2/repo/manifests/sha256:abc',
      },
    ]);
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
    const authorization: string = basicAuthorizationHeader('reader', 'read-password');

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

  it('rewrites registry location headers for normal proxied responses', async (): Promise<void> => {
    let targetUrl: string = '';
    const targetServer: Server = await listen(
      createServer((_request: IncomingMessage, response: ServerResponse): void => {
        response.writeHead(307, {
          location: `${targetUrl}/v2/repo/blobs/uploads/upload-id`,
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

    await expect(
      readFetchResponse(`${proxyUrl}/v2/repo/blobs/uploads/`, {
        headers: {
          authorization: basicAuthorizationHeader('writer', 'write-password'),
        },
        method: 'POST',
        redirect: 'manual',
      }),
    ).resolves.toEqual({
      location: `${proxyUrl}/v2/repo/blobs/uploads/upload-id`,
      status: 307,
    });
  });
});

async function startProxyProcess(targetUrl: string, proxyPort: number): Promise<ChildProcessWithoutNullStreams> {
  const stderrChunks: string[] = [];
  const workerPackageDirectory: string = resolvePath(__dirname, '..');
  const proxyScriptPath: string = resolvePath(workerPackageDirectory, 'src/registry-auth-proxy.ts');
  const child: ChildProcessWithoutNullStreams = spawn('pnpm', ['exec', 'tsx', proxyScriptPath], {
    cwd: workerPackageDirectory,
    env: createProxyEnvironment(targetUrl, proxyPort),
  });
  child.stderr.on('data', (chunk: Buffer): void => {
    stderrChunks.push(chunk.toString('utf8'));
  });
  await waitForProxyReady(`http://127.0.0.1:${proxyPort.toString()}/v2/`, child, stderrChunks);

  return child;
}

function createProxyEnvironment(targetUrl: string, proxyPort: number): NodeJS.ProcessEnv {
  return {
    ...process.env,
    COMPARTMENT_ARTIFACT_REGISTRY_PROXY_BIND_HOST: '127.0.0.1',
    COMPARTMENT_ARTIFACT_REGISTRY_PROXY_PORT: proxyPort.toString(),
    COMPARTMENT_ARTIFACT_REGISTRY_PROXY_TARGET_URL: targetUrl,
    COMPARTMENT_ARTIFACT_REGISTRY_READ_PASSWORD: 'read-password',
    COMPARTMENT_ARTIFACT_REGISTRY_READ_USERNAME: 'reader',
    COMPARTMENT_ARTIFACT_REGISTRY_WRITE_PASSWORD: 'write-password',
    COMPARTMENT_ARTIFACT_REGISTRY_WRITE_USERNAME: 'writer',
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
    return (await readStatus(url)) === 401;
  } catch {
    return false;
  }
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

function basicAuthorizationHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
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
