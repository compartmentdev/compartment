import { compartmentIdempotencyKeyHeaderName, type SignupResponse } from '@compartment/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCompartmentRequester } from '../src/http/request';
import type { CompartmentRequester } from '../src/http/request.types';
import { signUpToCompartment } from '../src/services/signup.service';
import { createJsonResponse, mockFetchSequence, readRequestHeaders } from './fetch-test-helpers';
import type { FetchMockState } from './fetch-test.types';

const signupIdempotencyKey: string = '5f3a9f3e-0a2c-4f1d-9d1e-0b8f2c7a4d61';

describe('signup service', (): void => {
  afterEach((): void => {
    vi.unstubAllGlobals();
  });

  it('puts the caller key on the wire so the API can recognize a retried signup', async (): Promise<void> => {
    const request: CompartmentRequester = createCompartmentRequester({ apiUrl: 'https://console.example' });
    const fetchState: FetchMockState = mockFetchSequence([createJsonResponse(createSignupResponse())]);

    await signUpToCompartment(request, { organizationName: 'Agent Org' }, signupIdempotencyKey);

    expect(readRequestHeaders(fetchState.calls[0]!).get(compartmentIdempotencyKeyHeaderName)).toBe(
      signupIdempotencyKey,
    );
  });
});

function createSignupResponse(): SignupResponse {
  return {
    organizations: [{ id: 'org_agent', name: 'Agent Org', slug: 'agent-org' }],
    principal: { email: 'prn_agent@signup.example.com', id: 'prn_agent', type: 'user' },
    sessionToken: 'signup-session-token',
  };
}
