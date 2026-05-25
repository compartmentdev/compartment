import {
  compartmentInternalNodeRegistrationPathname,
  type NodeRegistrationRequest,
  type NodeRegistrationResponse,
} from '@compartment/contracts';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createRegisterNode } from '../src/services/registration-api.service';
import type { RegisterNode } from '../src/services/registration-api.types';

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

describe('createRegisterNode', (): void => {
  afterEach((): void => {
    vi.unstubAllGlobals();
  });

  it('sends node registration through the SDK with the runtime control bearer token', async (): Promise<void> => {
    const response: NodeRegistrationResponse = {
      node: {
        id: 'node_123',
        name: 'local-node',
        nodeSocketPath: '/tmp/compartment/node-test/node/agent.sock',
        nodeVersion: '0.1.0',
      },
      registeredAt: '2026-03-30T12:00:00.000Z',
    };
    const registerNode: RegisterNode = createRegisterNode({
      apiUrl: 'https://console.example',
      runtimeControlToken: 'worker-secret',
    });
    const payload: NodeRegistrationRequest = {
      nodeName: 'local-node',
      nodeSocketPath: '/tmp/compartment/node-test/node/agent.sock',
      nodeVersion: '0.1.0',
    };
    const fetchMock: Mock<FetchImplementation> = vi
      .fn()
      .mockImplementation(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        await Promise.resolve();
        expect(input).toBe(`https://console.example${compartmentInternalNodeRegistrationPathname}`);
        expect(init?.method).toBe('POST');
        expect(readAuthorizationHeader(init)).toBe('Bearer worker-secret');

        return new Response(JSON.stringify(response), {
          headers: {
            'Content-Type': 'application/json',
          },
          status: 200,
        });
      });
    vi.stubGlobal('fetch', fetchMock);

    const result: NodeRegistrationResponse = await registerNode(payload);

    expect(result.node.id).toBe('node_123');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

function readAuthorizationHeader(init: RequestInit | undefined): string | null {
  const headers: Headers = new Headers(init?.headers);

  return headers.get('Authorization');
}
