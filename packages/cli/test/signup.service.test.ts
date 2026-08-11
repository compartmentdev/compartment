import type { SignupResponse } from '@compartment/contracts';
import type * as CompartmentSdk from '@compartment/sdk';
import type { signUpToCompartment } from '@compartment/sdk';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { signUp } from '../src/services/signup.service';

type SignUpToCompartment = typeof signUpToCompartment;
type ImportCompartmentSdkOriginal = () => Promise<typeof CompartmentSdk>;

interface SignupServiceMocks {
  signUpToCompartment: Mock<SignUpToCompartment>;
}

interface TransportFailureError extends Error {
  cause: {
    cause: {
      code: string;
    };
  };
}

interface RequestFailureError extends Error {
  code: string;
  method: 'POST';
  statusCode: number;
  url: string;
}

const mocks: SignupServiceMocks = vi.hoisted(
  (): SignupServiceMocks => ({
    signUpToCompartment: vi.fn<SignUpToCompartment>(),
  }),
);

vi.mock('@compartment/sdk', async (importOriginal: ImportCompartmentSdkOriginal): Promise<typeof CompartmentSdk> => {
  const actual: typeof CompartmentSdk = await importOriginal();
  return {
    ...actual,
    signUpToCompartment: mocks.signUpToCompartment,
  };
});

describe('cli signup service', (): void => {
  afterEach((): void => {
    vi.useRealTimers();
    mocks.signUpToCompartment.mockReset();
  });

  it('recovers a dropped signup by retrying it under the key the first attempt used', async (): Promise<void> => {
    vi.useFakeTimers();
    mocks.signUpToCompartment
      .mockRejectedValueOnce(createTransportFailure('ECONNRESET'))
      .mockResolvedValueOnce(createSignupResponse());

    const signupPromise: Promise<SignupResponse> = signUp(
      { apiUrl: 'https://console.example' },
      { organizationName: 'Agent Org' },
    );
    const signupAssertion: Promise<void> = expect(signupPromise).resolves.toEqual(createSignupResponse());

    await vi.advanceTimersByTimeAsync(1_000);

    await signupAssertion;
    expect(mocks.signUpToCompartment).toHaveBeenCalledTimes(2);
    expect(readIdempotencyKey(1)).toBe(readIdempotencyKey(0));
  });

  it('mints a separate key for every signup so two accounts never collide', async (): Promise<void> => {
    mocks.signUpToCompartment.mockResolvedValue(createSignupResponse());

    await signUp({ apiUrl: 'https://console.example' }, { organizationName: 'First Org' });
    await signUp({ apiUrl: 'https://console.example' }, { organizationName: 'Second Org' });

    expect(readIdempotencyKey(1)).not.toBe(readIdempotencyKey(0));
  });

  it('gives up without retrying when the API refuses the signup outright', async (): Promise<void> => {
    mocks.signUpToCompartment.mockRejectedValue(
      createRequestFailure(403, 'signup_disabled', 'Self-service signup is disabled on this Compartment installation.'),
    );

    await expect(signUp({ apiUrl: 'https://console.example' }, { organizationName: 'Agent Org' })).rejects.toThrow(
      'Self-service signup is disabled on this Compartment installation.',
    );
    expect(mocks.signUpToCompartment).toHaveBeenCalledTimes(1);
  });

  it('reports a rate-limited signup instead of spending the rest of the budget on it', async (): Promise<void> => {
    mocks.signUpToCompartment.mockRejectedValue(
      createRequestFailure(429, 'api_rate_limit_exceeded', 'API rate limit exceeded. Try again later.'),
    );

    await expect(signUp({ apiUrl: 'https://console.example' }, { organizationName: 'Agent Org' })).rejects.toThrow(
      'API rate limit exceeded. Try again later.',
    );
    expect(mocks.signUpToCompartment).toHaveBeenCalledTimes(1);
  });

  it('surfaces the last failure when every attempt is dropped', async (): Promise<void> => {
    vi.useFakeTimers();
    mocks.signUpToCompartment.mockRejectedValue(createTransportFailure('ECONNRESET'));

    const signupPromise: Promise<SignupResponse> = signUp(
      { apiUrl: 'https://console.example' },
      { organizationName: 'Agent Org' },
    );
    const signupAssertion: Promise<void> = expect(signupPromise).rejects.toThrow(
      'POST /v1/auth/signup failed: connection closed.',
    );

    await vi.advanceTimersByTimeAsync(3_000);

    await signupAssertion;
    expect(mocks.signUpToCompartment).toHaveBeenCalledTimes(3);
    expect(readIdempotencyKey(2)).toBe(readIdempotencyKey(0));
  });
});

function createRequestFailure(statusCode: number, code: string, message: string): RequestFailureError {
  return Object.assign(new Error(message), {
    code,
    method: 'POST' as const,
    name: 'CompartmentRequestError',
    statusCode,
    url: 'https://console.example/v1/auth/signup',
  });
}

function readIdempotencyKey(callIndex: number): string {
  return mocks.signUpToCompartment.mock.calls[callIndex]![2];
}

function createTransportFailure(code: string): TransportFailureError {
  return Object.assign(new Error('POST /v1/auth/signup failed: connection closed.'), {
    cause: {
      cause: {
        code,
      },
    },
  });
}

function createSignupResponse(): SignupResponse {
  return {
    organizations: [{ id: 'org_agent', name: 'Agent Org', slug: 'agent-org' }],
    principal: { email: 'prn_agent@signup.example.com', id: 'prn_agent', type: 'user' },
    sessionToken: 'signup-session-token',
  };
}
