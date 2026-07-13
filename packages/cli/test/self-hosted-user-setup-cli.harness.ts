import { loginResponseSchema, type LoginResponse } from '@compartment/contracts';
import { completeCliBrowserPasswordLogin } from './cli-browser-login-test.harness';
import { waitForCliVerificationUrl } from './self-hosted-user-setup-browser-login.harness';
import {
  expectFailedCommand,
  expectSuccessfulCommand,
  runBuiltCliJsonCommandLine,
  splitCliCommandLine,
  startBuiltCliCommandLine,
  type SelfHostedUserSetupCommandResult,
  type SelfHostedUserSetupJsonParser,
  type SelfHostedUserSetupRunningCommand,
} from './self-hosted-user-setup-command.harness';

interface SelfHostedUserSetupLoginCredentials {
  readonly email: string;
  readonly password: string;
}

interface SelfHostedUserSetupBrowserLoginOptions {
  readonly requestOrigin?: string | undefined;
}

interface SelfHostedUserSetupCliRunOptions {
  readonly cwd?: string | undefined;
  readonly input?: string | undefined;
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
    const loginCommand: SelfHostedUserSetupRunningCommand = startBuiltCliCommandLine({
      command,
      env: this.#env,
      timeoutMs: this.#timeoutMs,
    });

    await completeCliBrowserPasswordLogin({
      email: credentials.email,
      password: credentials.password,
      requestOrigin: options.requestOrigin,
      verificationUrlPromise: waitForCliVerificationUrl(loginCommand),
    });

    const loginResult: SelfHostedUserSetupCommandResult = await loginCommand.result;
    expectSuccessfulCommand(loginResult, command);

    return loginResponseSchema.parse(JSON.parse(loginResult.stdout));
  }

  async runJson<TPayload>(
    command: string,
    parser: SelfHostedUserSetupJsonParser<TPayload>,
    options: SelfHostedUserSetupCliRunOptions = {},
  ): Promise<TPayload> {
    return await runBuiltCliJsonCommandLine({
      command: buildSelfHostedUserSetupJsonCommand(command),
      cwd: options.cwd,
      env: this.#env,
      input: options.input,
      parser,
      timeoutMs: this.#timeoutMs,
    });
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
    const result: SelfHostedUserSetupCommandResult = await startBuiltCliCommandLine({
      command,
      cwd: options.cwd,
      env: this.#env,
      input: options.input,
      timeoutMs: this.#timeoutMs,
    }).result;

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
