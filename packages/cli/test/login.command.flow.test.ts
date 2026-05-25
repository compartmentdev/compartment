import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type {
  CliLoginExchangeRequest,
  CliLoginStartRequest,
  CliLoginStartResponse,
  CliLoginStatusRequest,
  CliLoginStatusResponse,
  LoginResponse,
} from '@compartment/contracts';
import { createLoginResponseFixture } from './cli-test.fixtures';
import { createCliCapture, readCliStderr, type CliCommandCapture } from './cli-test.harness';
import { performLoginCommandFlow } from '../src/commands/auth/login.command.flow';
import type { CliIo } from '../src/app.types';
import type { CliCommandDependencies } from '../src/commands/command.types';
import type { ApiContext } from '../src/services/context.types';

type ExchangeCliLogin = (context: ApiContext, input: CliLoginExchangeRequest) => Promise<LoginResponse>;
type GetCliLoginStatus = (context: ApiContext, input: CliLoginStatusRequest) => Promise<CliLoginStatusResponse>;
type Sleep = (delay: number) => Promise<void>;
type StartCliLogin = (context: ApiContext, input: CliLoginStartRequest) => Promise<CliLoginStartResponse>;

interface LoginCommandFlowMocks {
  exchangeCliLogin: Mock<ExchangeCliLogin>;
  getCliLoginStatus: Mock<GetCliLoginStatus>;
  sleep: Mock<Sleep>;
  startCliLogin: Mock<StartCliLogin>;
}

const originalNoColor: string | undefined = process.env.NO_COLOR;
const mocks: LoginCommandFlowMocks = vi.hoisted(
  (): LoginCommandFlowMocks => ({
    exchangeCliLogin: vi.fn<ExchangeCliLogin>(),
    getCliLoginStatus: vi.fn<GetCliLoginStatus>(),
    sleep: vi.fn<Sleep>(),
    startCliLogin: vi.fn<StartCliLogin>(),
  }),
);

vi.mock(
  '../src/services/cli-login.service',
  (): Record<string, Mock> => ({
    exchangeCliLogin: mocks.exchangeCliLogin,
    getCliLoginStatus: mocks.getCliLoginStatus,
    startCliLogin: mocks.startCliLogin,
  }),
);

vi.mock(
  'node:timers/promises',
  (): Record<string, Mock> => ({
    setTimeout: mocks.sleep,
  }),
);

describe('login command flow', (): void => {
  beforeEach((): void => {
    Object.values(mocks).forEach((mock: Mock): void => {
      mock.mockReset();
    });
    mocks.sleep.mockResolvedValue(undefined);
  });

  afterEach((): void => {
    restoreNoColorEnv();
  });

  it('runs the browser-assisted login flow with an explicit email hint', async (): Promise<void> => {
    delete process.env.NO_COLOR;
    const capture: CliCommandCapture = createCliCapture({ stderrIsTTY: true });
    mocks.startCliLogin.mockResolvedValueOnce({
      attemptId: 'cla_123',
      exchangeSecret: 'exchange-secret',
      expiresAt: '2099-04-21T10:10:00.000Z',
      pollAfterMs: 1,
      verificationUrl: 'https://compartment.localhost/login/cli?attempt=cla_123#code=browser-code',
    });
    mocks.getCliLoginStatus
      .mockResolvedValueOnce({ expiresAt: '2099-04-21T10:10:00.000Z', status: 'pending' })
      .mockResolvedValueOnce({ expiresAt: '2099-04-21T10:10:00.000Z', status: 'authenticated' });
    mocks.exchangeCliLogin.mockResolvedValueOnce(createLoginResponseFixture());

    const response: LoginResponse = await performLoginCommandFlow(
      createCommandDependencies(capture.io),
      { apiUrl: 'https://compartment.localhost' },
      'owner@example.com',
      undefined,
      'acme-dev',
    );

    expect(response).toEqual(createLoginResponseFixture());
    expect(mocks.startCliLogin).toHaveBeenCalledWith(
      { apiUrl: 'https://compartment.localhost' },
      { email: 'owner@example.com', organizationSlug: 'acme-dev' },
    );
    expect(readCliStderr(capture)).toContain('Open this URL in a browser');
    expect(readCliStderr(capture)).toContain('\u001B[1mOpen this URL in a browser to continue login:\u001B[22m');
    expect(readCliStderr(capture)).not.toContain('Waiting for browser authentication to complete');
    expect(readCliStderr(capture)).toContain('Browser authentication completed. Finishing login');
  });

  it('does not style the login prompt when stderr is redirected', async (): Promise<void> => {
    delete process.env.NO_COLOR;
    const capture: CliCommandCapture = createCliCapture({ isTTY: true, stderrIsTTY: false });
    mocks.startCliLogin.mockResolvedValueOnce({
      attemptId: 'cla_123',
      exchangeSecret: 'exchange-secret',
      expiresAt: '2099-04-21T10:10:00.000Z',
      pollAfterMs: 1,
      verificationUrl: 'https://compartment.localhost/login/cli?attempt=cla_123#code=browser-code',
    });
    mocks.getCliLoginStatus.mockResolvedValueOnce({
      expiresAt: '2099-04-21T10:10:00.000Z',
      status: 'authenticated',
    });
    mocks.exchangeCliLogin.mockResolvedValueOnce(createLoginResponseFixture());

    await performLoginCommandFlow(
      createCommandDependencies(capture.io),
      { apiUrl: 'https://compartment.localhost' },
      'owner@example.com',
    );

    expect(readCliStderr(capture)).toContain('Open this URL in a browser to continue login:');
    expect(readCliStderr(capture)).not.toContain('\u001B[1m');
  });

  it('fails cleanly when the CLI login attempt expires while polling', async (): Promise<void> => {
    mocks.startCliLogin.mockResolvedValueOnce({
      attemptId: 'cla_123',
      exchangeSecret: 'exchange-secret',
      expiresAt: '2099-04-21T10:10:00.000Z',
      pollAfterMs: 1,
      verificationUrl: 'https://compartment.localhost/login/cli?attempt=cla_123#code=browser-code',
    });
    mocks.getCliLoginStatus.mockResolvedValueOnce({
      expiresAt: '2099-04-21T10:10:00.000Z',
      status: 'expired',
    });

    await expect(
      performLoginCommandFlow(createCommandDependencies(createCliCapture().io), {
        apiUrl: 'https://compartment.localhost',
      }),
    ).rejects.toThrow('CLI login expired before it was completed. Run `compartment login` again.');
  });
});

function createCommandDependencies(io: CliIo): CliCommandDependencies {
  return {
    argv: [],
    commandPrefix: ['compartment'],
    io,
  };
}

function restoreNoColorEnv(): void {
  if (originalNoColor === undefined) {
    delete process.env.NO_COLOR;
    return;
  }

  process.env.NO_COLOR = originalNoColor;
}
