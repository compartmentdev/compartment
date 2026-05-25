import type { LookupAddress } from 'node:dns';
import {
  createServer,
  type ClientRequest,
  type IncomingMessage,
  type RequestOptions,
  type Server,
  type ServerResponse,
} from 'node:http';
import { EventEmitter } from 'node:events';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createOutboundHttpFetch } from '../src';
import type { OutboundDnsLookupAddress, OutboundDnsResolver } from '../src/outbound-http/outbound-http-client.types';

type CreateHttpsRequest = (options: RequestOptions, callback: (response: IncomingMessage) => void) => ClientRequest;

interface LocalHttpRequest {
  method: string;
  url: string;
}

interface LocalHttpServerHandle {
  close: () => Promise<void>;
  origin: string;
  requests: LocalHttpRequest[];
}

type LocalHttpRequestHandler = (request: IncomingMessage, response: ServerResponse) => Promise<void> | void;

interface OutboundHttpClientTestMocks {
  createHttpsRequest: Mock<CreateHttpsRequest>;
}

const mocks: OutboundHttpClientTestMocks = vi.hoisted(
  (): OutboundHttpClientTestMocks => ({
    createHttpsRequest: vi.fn<CreateHttpsRequest>(),
  }),
);

vi.mock('node:https', (): { request: Mock<CreateHttpsRequest> } => ({
  request: mocks.createHttpsRequest,
}));

beforeEach((): void => {
  mocks.createHttpsRequest.mockReset();
});

describe('outbound HTTP client SSRF policy', (): void => {
  it('supports the Node all=true lookup callback shape used by request sockets', async (): Promise<void> => {
    const resolvedAddresses: LookupAddress[] = [
      { address: readExamplePublicIpv6Address(), family: 6 },
      { address: readExamplePublicAddress(), family: 4 },
    ];
    mocks.createHttpsRequest.mockImplementationOnce(
      createMockLookupAllHttpsRequestImplementation([
        {
          address: readExamplePublicAddress(),
          family: 4,
        },
      ]),
    );
    const outboundFetch: typeof fetch = createOutboundHttpFetch({
      addressPolicy: 'public',
      allowedProtocols: ['https:'],
      dnsResolver: new MultiAddressDnsResolver(resolvedAddresses),
      trustedHosts: ['api.github.com'],
    });

    const response: Response = await outboundFetch('https://api.github.com/users/acme');

    await expect(response.json()).resolves.toEqual({ type: 'User' });
    expect(mocks.createHttpsRequest).toHaveBeenCalledTimes(1);
  });

  it('uses the Node all=true error callback shape when lookup rejects', async (): Promise<void> => {
    mocks.createHttpsRequest.mockImplementationOnce(createMockLookupAllHttpsErrorRequestImplementation());
    const outboundFetch: typeof fetch = createOutboundHttpFetch({
      addressPolicy: 'public',
      allowedProtocols: ['https:'],
      dnsResolver: new SingleAddressDnsResolver('127.0.0.1'),
      trustedHosts: ['api.github.com'],
    });

    await expect(outboundFetch('https://api.github.com/users/acme')).rejects.toThrow('unsafe address 127.0.0.1');
  });

  it('blocks direct loopback targets before a socket reaches the target', async (): Promise<void> => {
    const server: LocalHttpServerHandle = await startLocalHttpServer(
      (_request: IncomingMessage, response: ServerResponse): void => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ ok: true }));
      },
    );

    try {
      const outboundFetch: typeof fetch = createOutboundHttpFetch({
        addressPolicy: 'public',
        allowedProtocols: ['http:'],
        trustedHosts: [new URL(server.origin).host],
      });

      await expect(outboundFetch(`${server.origin}/metadata`)).rejects.toThrow('unsafe address 127.0.0.1');
      expect(server.requests).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it('checks target policy before consuming request bodies', async (): Promise<void> => {
    const outboundFetch: typeof fetch = createOutboundHttpFetch({
      addressPolicy: 'public',
      allowedProtocols: ['http:'],
      trustedHosts: ['127.0.0.1'],
    });

    await expect(
      outboundFetch('http://127.0.0.1/metadata', {
        body: new ReadableStream<Uint8Array>(),
        duplex: 'half',
        method: 'POST',
      }),
    ).rejects.toThrow('unsafe address 127.0.0.1');
  });

  it('blocks metadata addresses returned by DNS resolution', async (): Promise<void> => {
    const metadataAddress: string = readMetadataAddress();
    const metadataResolver: OutboundDnsResolver = new SingleAddressDnsResolver(metadataAddress);
    const outboundFetch: typeof fetch = createOutboundHttpFetch({
      addressPolicy: 'public',
      allowedProtocols: ['http:'],
      dnsResolver: metadataResolver,
      trustedHosts: ['idp.example.com'],
    });

    await expect(outboundFetch('http://idp.example.com/.well-known/openid-configuration')).rejects.toThrow(
      `unsafe address ${metadataAddress}`,
    );
  });

  it('uses the validated DNS answer for the socket instead of rebinding through the OS resolver', async (): Promise<void> => {
    const server: LocalHttpServerHandle = await startLocalHttpServer(
      (_request: IncomingMessage, response: ServerResponse): void => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ reached: true }));
      },
    );
    const localhostUrl: string = server.origin.replace('127.0.0.1', 'localhost');
    const publicResolver: OutboundDnsResolver = new SingleAddressDnsResolver(readExamplePublicAddress());

    try {
      const outboundFetch: typeof fetch = createOutboundHttpFetch({
        addressPolicy: 'public',
        allowedProtocols: ['http:'],
        dnsResolver: publicResolver,
        timeoutMs: 250,
        trustedHosts: [new URL(localhostUrl).host],
      });

      await expect(outboundFetch(`${localhostUrl}/rebind`)).rejects.toThrow();
      expect(server.requests).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it('revalidates redirects and refuses to forward bodies across origins', async (): Promise<void> => {
    const targetServer: LocalHttpServerHandle = await startLocalHttpServer(
      (_request: IncomingMessage, response: ServerResponse): void => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ reached: true }));
      },
    );
    const redirectServer: LocalHttpServerHandle = await startLocalHttpServer(
      (_request: IncomingMessage, response: ServerResponse): void => {
        response.writeHead(307, { location: `${targetServer.origin}/body-leak` });
        response.end();
      },
    );

    try {
      const outboundFetch: typeof fetch = createOutboundHttpFetch({
        addressPolicy: 'internal',
        allowedProtocols: ['http:'],
      });

      await expect(
        outboundFetch(`${redirectServer.origin}/redirect`, {
          body: JSON.stringify({ secret: 'request-body' }),
          headers: {
            authorization: 'Bearer app-token',
            'content-type': 'application/json',
          },
          method: 'POST',
        }),
      ).rejects.toThrow('cross-origin redirect with request body');
      expect(targetServer.requests).toHaveLength(0);
    } finally {
      await redirectServer.close();
      await targetServer.close();
    }
  });

  it('revalidates redirect target trust before opening the redirected socket', async (): Promise<void> => {
    const targetServer: LocalHttpServerHandle = await startLocalHttpServer(
      (_request: IncomingMessage, response: ServerResponse): void => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ reached: true }));
      },
    );
    const redirectServer: LocalHttpServerHandle = await startLocalHttpServer(
      (_request: IncomingMessage, response: ServerResponse): void => {
        response.writeHead(302, { location: `${targetServer.origin}/private-target` });
        response.end();
      },
    );

    try {
      const outboundFetch: typeof fetch = createOutboundHttpFetch({
        addressPolicy: 'internal',
        allowedProtocols: ['http:'],
        trustedHosts: [new URL(redirectServer.origin).host],
      });

      await expect(outboundFetch(`${redirectServer.origin}/redirect`)).rejects.toThrow('is not trusted');
      expect(targetServer.requests).toHaveLength(0);
    } finally {
      await redirectServer.close();
      await targetServer.close();
    }
  });

  it('limits streamed response bodies', async (): Promise<void> => {
    const server: LocalHttpServerHandle = await startLocalHttpServer(
      (_request: IncomingMessage, response: ServerResponse): void => {
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.end('0123456789');
      },
    );

    try {
      const outboundFetch: typeof fetch = createOutboundHttpFetch({
        addressPolicy: 'internal',
        allowedProtocols: ['http:'],
        maxResponseBytes: 4,
      });

      const response: Response = await outboundFetch(`${server.origin}/large`);
      await expect(response.text()).rejects.toThrow('response exceeded 4 bytes');
    } finally {
      await server.close();
    }
  });

  it('preserves an explicit null response size limit', async (): Promise<void> => {
    const bodySize: number = 16 * 1024 * 1024 + 1;
    const server: LocalHttpServerHandle = await startLocalHttpServer(
      (_request: IncomingMessage, response: ServerResponse): void => {
        response.writeHead(200, { 'content-type': 'application/octet-stream' });
        response.end(Buffer.alloc(bodySize));
      },
    );

    try {
      const outboundFetch: typeof fetch = createOutboundHttpFetch({
        addressPolicy: 'internal',
        allowedProtocols: ['http:'],
        maxResponseBytes: null,
      });

      const response: Response = await outboundFetch(`${server.origin}/archive`);
      expect((await response.arrayBuffer()).byteLength).toBe(bodySize);
    } finally {
      await server.close();
    }
  });

  it('applies the request timeout while reading streamed response bodies', async (): Promise<void> => {
    const server: LocalHttpServerHandle = await startLocalHttpServer(
      (_request: IncomingMessage, response: ServerResponse): void => {
        response.writeHead(200, { 'content-type': 'text/plain' });
        response.flushHeaders();
      },
    );

    try {
      const outboundFetch: typeof fetch = createOutboundHttpFetch({
        addressPolicy: 'internal',
        allowedProtocols: ['http:'],
        timeoutMs: 50,
      });

      const response: Response = await outboundFetch(`${server.origin}/stalled`);
      await expect(response.text()).rejects.toThrow('timed out');
    } finally {
      await server.close();
    }
  });
});

async function startLocalHttpServer(handler: LocalHttpRequestHandler): Promise<LocalHttpServerHandle> {
  const requests: LocalHttpRequest[] = [];
  const server: Server = createServer((request: IncomingMessage, response: ServerResponse): void => {
    requests.push({
      method: request.method ?? 'GET',
      url: request.url ?? '/',
    });
    void Promise.resolve(handler(request, response)).catch((): void => {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'test_http_server_failed' }));
    });
  });

  await new Promise<void>((resolve: () => void): void => {
    server.listen(0, '127.0.0.1', resolve);
  });

  return new RunningLocalHttpServer(server, readLocalHttpServerOrigin(server), requests);
}

class RunningLocalHttpServer implements LocalHttpServerHandle {
  public constructor(
    private readonly server: Server,
    public readonly origin: string,
    public readonly requests: LocalHttpRequest[],
  ) {}

  public async close(): Promise<void> {
    await new Promise<void>((resolve: () => void, reject: (reason?: Error) => void): void => {
      this.server.close((error?: Error): void => {
        if (error !== undefined) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

class SingleAddressDnsResolver implements OutboundDnsResolver {
  public constructor(private readonly address: string) {}

  public async lookup(): Promise<OutboundDnsLookupAddress[]> {
    return await Promise.resolve([{ address: this.address, family: 4 }]);
  }
}

class MultiAddressDnsResolver implements OutboundDnsResolver {
  public constructor(private readonly addresses: readonly LookupAddress[]) {}

  public async lookup(): Promise<OutboundDnsLookupAddress[]> {
    return await Promise.resolve(
      this.addresses.map(
        (address: LookupAddress): OutboundDnsLookupAddress => ({
          address: address.address,
          family: address.family === 6 ? 6 : 4,
        }),
      ),
    );
  }
}

function readLocalHttpServerOrigin(server: Server): string {
  const address: AddressInfo | string | null = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected local HTTP server to listen on a TCP port.');
  }

  return `http://127.0.0.1:${address.port.toString()}`;
}

function readMetadataAddress(): string {
  return ['169', '254', '169', '254'].join('.');
}

function readExamplePublicAddress(): string {
  return ['93', '184', '216', '34'].join('.');
}

function readExamplePublicIpv6Address(): string {
  return ['2606', '2800', '220', '1', '248', '1893', '25c8', '1946'].join(':');
}

function createMockLookupAllHttpsRequestImplementation(expectedAddresses: LookupAddress[]): CreateHttpsRequest {
  return (options: RequestOptions, callback: (response: IncomingMessage) => void): ClientRequest =>
    createMockLookupAllHttpsRequest(options, callback, expectedAddresses);
}

function createMockLookupAllHttpsErrorRequestImplementation(): CreateHttpsRequest {
  return (options: RequestOptions, callback: (response: IncomingMessage) => void): ClientRequest => {
    void callback;
    return createMockLookupAllHttpsErrorRequest(options);
  };
}

function createMockLookupAllHttpsRequest(
  options: RequestOptions,
  callback: (response: IncomingMessage) => void,
  expectedAddresses: LookupAddress[],
): ClientRequest {
  const request: ClientRequest = new EventEmitter() as ClientRequest;
  request.destroy = vi.fn((): ClientRequest => request);
  request.end = vi.fn((): ClientRequest => {
    if (typeof options.hostname !== 'string' || options.lookup === undefined) {
      throw new Error('Expected outbound HTTPS request options to include hostname and lookup.');
    }

    options.lookup(
      options.hostname,
      { all: true, family: 4 },
      (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family: number | undefined): void => {
        if (error !== null) {
          request.emit('error', error);
          return;
        }
        if (!Array.isArray(address) || family !== undefined) {
          request.emit('error', new Error('Expected lookup to return an address array for all=true.'));
          return;
        }

        expect(address).toEqual(expectedAddresses);
        callback(createJsonResponse({ type: 'User' }));
      },
    );

    return request;
  }) as typeof request.end;

  return request;
}

function createMockLookupAllHttpsErrorRequest(options: RequestOptions): ClientRequest {
  const request: ClientRequest = new EventEmitter() as ClientRequest;
  request.destroy = vi.fn((): ClientRequest => request);
  request.end = vi.fn((): ClientRequest => {
    if (typeof options.hostname !== 'string' || options.lookup === undefined) {
      throw new Error('Expected outbound HTTPS request options to include hostname and lookup.');
    }

    options.lookup(
      options.hostname,
      { all: true, family: 4 },
      (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family: number | undefined): void => {
        expect(error).toBeInstanceOf(Error);
        expect(address).toEqual([]);
        expect(family).toBeUndefined();
        request.emit('error', error ?? new Error('Expected lookup to fail.'));
      },
    );

    return request;
  }) as typeof request.end;

  return request;
}

function createJsonResponse(payload: object): IncomingMessage {
  const responseBody: Buffer = Buffer.from(JSON.stringify(payload));
  const response: Readable = Readable.from([responseBody]);
  return Object.assign(response, {
    headers: { 'content-type': 'application/json' },
    statusCode: 200,
    statusMessage: 'OK',
  }) as IncomingMessage;
}
