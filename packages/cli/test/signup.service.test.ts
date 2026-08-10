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
    expect(readIdempotencyKey(0)).toMatch(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u);
  });

  it('mints a separate key for every signup so two accounts never collide', async (): Promise<void> => {
    mocks.signUpToCompartment.mockResolvedValue(createSignupResponse());

    await signUp({ apiUrl: 'https://console.example' }, { organizationName: 'First Org' });
    await signUp({ apiUrl: 'https://console.example' }, { organizationName: 'Second Org' });

    expect(readIdempotencyKey(1)).not.toBe(readIdempotencyKey(0));
  });

  it('gives up without retrying when the API refuses the signup outright', async (): Promise<void> => {
    mocks.signUpToCompartment.mockRejectedValue(new Error('Self-service signup is disabled.'));

    await expect(signUp({ apiUrl: 'https://console.example' }, { organizationName: 'Agent Org' })).rejects.toThrow(
      'Self-service signup is disabled.',
    );
    expect(mocks.signUpToCompartment).toHaveBeenCalledTimes(1);
  });
});

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
