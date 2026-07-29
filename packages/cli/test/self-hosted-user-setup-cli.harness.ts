import { loginResponseSchema, type LoginResponse } from '@compartment/contracts';
import { Agent, fetch as undiciFetch, type Dispatcher } from 'undici';
import { completeCliBrowserPasswordLogin, type CliBrowserLoginRequestInit } from './cli-browser-login-test.harness';
import { waitForCliVerificationUrl } from './self-hosted-user-setup-browser-login.harness';
import {
  expectFailedCommand,
  expectSuccessfulCommand,
  runBuiltCliInteractiveCommandLine,
  runBuiltCliInteractiveJsonCommandLine,
  runBuiltCliJsonCommandLine,
  splitCliCommandLine,
  startBuiltCliCommandLine,
  type SelfHostedUserSetupCommandResult,
  type SelfHostedUserSetupCliCommandLineInput,
  type SelfHostedUserSetupJsonParser,
  type SelfHostedUserSetupCliJsonCommandLineInput,
  type SelfHostedUserSetupRunningCommand,
} from './self-hosted-user-setup-command.harness';

interface SelfHostedUserSetupLoginCredentials {
  readonly email: string;
  readonly password: string;
}

interface SelfHostedUserSetupBrowserLoginOptions {
  readonly certificateAuthority?: Buffer | undefined;
  readonly requestOrigin?: string | undefined;
}

interface SelfHostedUserSetupCliRunOptions {
  readonly cwd?: string | undefined;
  readonly input?: string | undefined;
  readonly interactive?: boolean | undefined;
}

const selfHostedUserSetupJsonOutputOption: string = '--output json';

export class SelfHostedUserSetupCli {
  readonly #env: NodeJS.ProcessEnv;
  readonly #timeoutMs: number;

  constructor(env: NodeJS.ProcessEnv, timeoutMs: number) {
    this.#env = env;
    this.#timeoutMs = timeoutMs;
  }

  readCommandEnvironment(): NodeJS.ProcessEnv {
    return { ...this.#env };
  }

  async runBrowserLogin(
    command: string,
    credentials: SelfHostedUserSetupLoginCredentials,
    options: SelfHostedUserSetupBrowserLoginOptions = {},
  ): Promise<LoginResponse> {
    const dispatcher: Dispatcher | undefined =
      options.certificateAuthority === undefined
        ? undefined
        : new Agent({ connect: { ca: options.certificateAuthority.toString('utf8') } });
    const loginCommand: SelfHostedUserSetupRunningCommand = startBuiltCliCommandLine({
      command,
      env: this.#env,
      timeoutMs: this.#timeoutMs,
    });

    try {
      await completeCliBrowserPasswordLogin({
        email: credentials.email,
        password: credentials.password,
        request:
          dispatcher === undefined
            ? undefined
            : async (url: URL, init?: CliBrowserLoginRequestInit): Promise<Response> =>
                await undiciFetch(url, {
                  dispatcher,
                  ...(init?.body === undefined ? {} : { body: init.body }),
                  ...(init?.headers === undefined ? {} : { headers: init.headers }),
                  ...(init?.method === undefined ? {} : { method: init.method }),
                }),
        requestOrigin: options.requestOrigin,
        verificationUrlPromise: waitForCliVerificationUrl(loginCommand),
      });
    } finally {
      await dispatcher?.close();
    }

    const loginResult: SelfHostedUserSetupCommandResult = await loginCommand.result;
    expectSuccessfulCommand(loginResult, command);

    return loginResponseSchema.parse(JSON.parse(loginResult.stdout));
  }

  async runJson<TPayload>(
    command: string,
    parser: SelfHostedUserSetupJsonParser<TPayload>,
    options: SelfHostedUserSetupCliRunOptions = {},
  ): Promise<TPayload> {
    const input: SelfHostedUserSetupCliJsonCommandLineInput<TPayload> = {
      command: buildSelfHostedUserSetupJsonCommand(command),
      cwd: options.cwd,
      env: this.#env,
      input: options.input,
      parser,
      timeoutMs: this.#timeoutMs,
    };
    return options.interactive === true
      ? await runBuiltCliInteractiveJsonCommandLine(input)
      : await runBuiltCliJsonCommandLine(input);
  }

  async run(
    command: string,
    options: SelfHostedUserSetupCliRunOptions = {},
  ): Promise<SelfHostedUserSetupCommandResult> {
    const result: SelfHostedUserSetupCommandResult = await startBuiltCliCommandLine({
      command,
      cwd: options.cwd,
      env: this.#env,
      input: options.input,
      timeoutMs: this.#timeoutMs,
    }).result;

    expectSuccessfulCommand(result, command);
    return result;
  }

  async runFailure(
    command: string,
    options: SelfHostedUserSetupCliRunOptions = {},
  ): Promise<SelfHostedUserSetupCommandResult> {
    const input: SelfHostedUserSetupCliCommandLineInput = {
      command,
      cwd: options.cwd,
      env: this.#env,
      input: options.input,
      timeoutMs: this.#timeoutMs,
    };
    const result: SelfHostedUserSetupCommandResult =
      options.interactive === true
        ? await runBuiltCliInteractiveCommandLine(input)
        : await startBuiltCliCommandLine(input).result;

    expectFailedCommand(result, command);
    return result;
  }
}

function buildSelfHostedUserSetupJsonCommand(command: string): string {
  if (hasExplicitOutputOption(command)) {
    throw new Error('runJson appends --output json automatically. Pass the command without --output.');
  }

  return `${command} ${selfHostedUserSetupJsonOutputOption}`;
}

function hasExplicitOutputOption(command: string): boolean {
  return splitCliCommandLine(command).some((arg: string): boolean => arg === '--output' || arg.startsWith('--output='));
}
