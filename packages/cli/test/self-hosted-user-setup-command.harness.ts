import { spawn, type ChildProcess } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { JsonValue } from '@compartment/utils';
import { expect } from 'vitest';

interface SelfHostedUserSetupCommandResultShape {
  readonly durationMs: number;
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

export interface SelfHostedUserSetupRunningCommand {
  readonly readStderr: () => string;
  readonly result: Promise<SelfHostedUserSetupCommandResult>;
}

interface SelfHostedUserSetupCommandInput {
  readonly argv: readonly string[];
  readonly cwd?: string | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly input?: string | undefined;
  readonly timeoutMs: number;
}

interface SelfHostedUserSetupCliCommandInput {
  readonly argv: readonly string[];
  readonly cwd?: string | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly input?: string | undefined;
  readonly timeoutMs: number;
}

interface SelfHostedUserSetupCliCommandLineInput {
  readonly command: string;
  readonly cwd?: string | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly input?: string | undefined;
  readonly timeoutMs: number;
}

interface SelfHostedUserSetupCliJsonCommandLineInput<TPayload> extends SelfHostedUserSetupCliCommandLineInput {
  readonly parser: SelfHostedUserSetupJsonParser<TPayload>;
}

export interface SelfHostedUserSetupJsonParser<TPayload> {
  parse(input: JsonValue): TPayload;
}

export class SelfHostedUserSetupCommandResult implements SelfHostedUserSetupCommandResultShape {
  readonly durationMs: number;
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;

  constructor(durationMs: number, exitCode: number, stderr: string, stdout: string) {
    this.durationMs = durationMs;
    this.exitCode = exitCode;
    this.stderr = stderr;
    this.stdout = stdout;
  }
}

class StartedSelfHostedUserSetupCommand implements SelfHostedUserSetupRunningCommand {
  readonly #readStderrValue: () => string;
  readonly result: Promise<SelfHostedUserSetupCommandResult>;

  constructor(readStderrValue: () => string, result: Promise<SelfHostedUserSetupCommandResult>) {
    this.#readStderrValue = readStderrValue;
    this.result = result;
  }

  readStderr(): string {
    return this.#readStderrValue();
  }
}

const selfHostedUserSetupOutputLimit: number = 96_000;
const selfHostedUserSetupForceKillDelayMs: number = 5_000;
const selfHostedUserSetupDiagnosticsTimeoutMs: number = 15_000;
const selfHostedUserSetupDockerCommandTimeoutMs: number = 60_000;
const selfHostedUserSetupEnabledEnvName: string = 'COMPARTMENT_SELF_HOSTED_USER_SETUP_E2E';
export const selfHostedUserSetupNodeAgentLogPathEnvName: string =
  'COMPARTMENT_SELF_HOSTED_USER_SETUP_NODE_AGENT_LOG_PATH';
const selfHostedUserSetupRepoRoot: string = resolve(__dirname, '../../..');
const selfHostedUserSetupCliBinPath: string = join(selfHostedUserSetupRepoRoot, '.compartment/cli-dist/compartment');
export const selfHostedComposeFilesScript: string = `
compose_files="-f /etc/compartment/docker-compose.self-hosted.yml"
if [ -f /etc/compartment/docker-compose.self-hosted.local.yml ]; then
  compose_files="$compose_files -f /etc/compartment/docker-compose.self-hosted.local.yml"
fi
`;
export const selfHostedDockerComposeCommand: string =
  'docker compose --project-directory /etc/compartment --env-file /etc/compartment/.env.self-hosted $compose_files';

export async function assertBuiltCliAvailable(): Promise<void> {
  await access(selfHostedUserSetupCliBinPath).catch((): never => {
    throw new Error('Expected the built CLI at .compartment/cli-dist/compartment. Run `pnpm cli:build:sea`.');
  });
}

export function buildSelfHostedUserSetupCliArgv(args: readonly string[]): readonly string[] {
  return [selfHostedUserSetupCliBinPath, ...args];
}

async function runBuiltCliCommand(
  input: SelfHostedUserSetupCliCommandInput,
): Promise<SelfHostedUserSetupCommandResult> {
  return await runCommand({
    ...input,
    argv: buildSelfHostedUserSetupCliArgv(input.argv),
  });
}

async function runBuiltCliCommandLine(
  input: SelfHostedUserSetupCliCommandLineInput,
): Promise<SelfHostedUserSetupCommandResult> {
  return await runBuiltCliCommand({
    ...input,
    argv: splitCliCommandLine(input.command),
  });
}

function startBuiltCliCommand(input: SelfHostedUserSetupCliCommandInput): SelfHostedUserSetupRunningCommand {
  return startCommand({
    ...input,
    argv: buildSelfHostedUserSetupCliArgv(input.argv),
  });
}

export function startBuiltCliCommandLine(
  input: SelfHostedUserSetupCliCommandLineInput,
): SelfHostedUserSetupRunningCommand {
  return startBuiltCliCommand({
    ...input,
    argv: splitCliCommandLine(input.command),
  });
}

export async function runBuiltCliJsonCommandLine<TPayload>(
  input: SelfHostedUserSetupCliJsonCommandLineInput<TPayload>,
): Promise<TPayload> {
  const result: SelfHostedUserSetupCommandResult = await runBuiltCliCommandLine(input);
  const diagnostics: string = result.exitCode === 0 ? '' : await readSelfHostedDiagnostics();
  expectSuccessfulCommand(result, input.command, diagnostics);

  return input.parser.parse(JSON.parse(result.stdout) as JsonValue);
}

export async function runCommand(input: SelfHostedUserSetupCommandInput): Promise<SelfHostedUserSetupCommandResult> {
  return await startCommand(input).result;
}

function startCommand(input: SelfHostedUserSetupCommandInput): SelfHostedUserSetupRunningCommand {
  const startedAt: number = performance.now();
  let stderr: string = '';
  let stdout: string = '';
  let completed: boolean = false;
  let timedOut: boolean = false;
  let forceKillTimeout: NodeJS.Timeout | null = null;
  const child: ChildProcess = spawn(input.argv[0] ?? '', input.argv.slice(1), {
    cwd: resolveCommandCwd(input),
    env: buildCommandEnv(input),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const resultPromise: Promise<SelfHostedUserSetupCommandResult> = new Promise<SelfHostedUserSetupCommandResult>(
    (resolveResult: (result: SelfHostedUserSetupCommandResult) => void): void => {
      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string | Buffer): void => {
        stdout = appendCappedOutput(stdout, chunk.toString());
      });
      child.stderr?.setEncoding('utf8');
      child.stderr?.on('data', (chunk: string | Buffer): void => {
        stderr = appendCappedOutput(stderr, chunk.toString());
      });
      child.on('error', (error: Error): void => {
        stderr = appendCappedOutput(stderr, error.message);
      });
      child.on('close', (code: number | null): void => {
        completed = true;
        clearCommandTimeouts(timeout, forceKillTimeout);
        resolveResult(
          new SelfHostedUserSetupCommandResult(
            performance.now() - startedAt,
            timedOut ? 124 : (code ?? 1),
            stderr,
            stdout,
          ),
        );
      });
    },
  );

  child.stdin?.end(input.input);
  const timeout: NodeJS.Timeout = setTimeout((): void => {
    if (completed) {
      return;
    }
    timedOut = true;
    stderr = appendCappedOutput(stderr, `\nTimed out after ${input.timeoutMs.toString()}ms.`);
    child.kill('SIGTERM');
    forceKillTimeout = setTimeout((): void => {
      child.kill('SIGKILL');
    }, selfHostedUserSetupForceKillDelayMs);
    forceKillTimeout.unref();
  }, input.timeoutMs);
  timeout.unref();

  return new StartedSelfHostedUserSetupCommand((): string => stderr, resultPromise);
}

function resolveCommandCwd(input: SelfHostedUserSetupCommandInput): string {
  return input.cwd ?? selfHostedUserSetupRepoRoot;
}

function buildCommandEnv(input: SelfHostedUserSetupCommandInput): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...(input.env ?? process.env) };
  const cwd: string = resolveCommandCwd(input);
  delete env.INIT_CWD;
  env.PWD = cwd;
  return env;
}

export async function runTimedStep<TResult>(label: string, step: () => Promise<TResult>): Promise<TResult> {
  const startedAt: number = performance.now();
  const result: TResult = await step();
  reportTimedStep(label, performance.now() - startedAt);
  return result;
}

function reportTimedStep(label: string, durationMs: number): void {
  process.stdout.write(`[self-hosted-user-setup] ${label}: ${Math.round(durationMs).toString()}ms\n`);
}

export function expectSuccessfulCommand(
  result: SelfHostedUserSetupCommandResult,
  commandName: string,
  diagnostics: string = '',
): void {
  expect(
    result.exitCode,
    `Expected ${commandName} to exit successfully after ${Math.round(result.durationMs).toString()}ms.\n` +
      `stderr:\n${formatCommandOutput(result.stderr)}\nstdout:\n${formatCommandOutput(result.stdout)}` +
      formatDiagnostics(diagnostics),
  ).toBe(0);
}

export function expectFailedCommand(result: SelfHostedUserSetupCommandResult, commandName: string): void {
  expect(
    result.exitCode,
    `Expected ${commandName} to fail after ${Math.round(result.durationMs).toString()}ms.\n` +
      `stderr:\n${formatCommandOutput(result.stderr)}\nstdout:\n${formatCommandOutput(result.stdout)}`,
  ).not.toBe(0);
}

export async function removeLocalDockerImage(imageRef: string): Promise<void> {
  const result: SelfHostedUserSetupCommandResult = await runCommand({
    argv: ['docker', 'image', 'rm', '-f', imageRef],
    timeoutMs: selfHostedUserSetupDockerCommandTimeoutMs,
  });

  expectSuccessfulCommand(result, `docker image rm ${imageRef}`);
}

export function formatCommandOutput(output: string): string {
  const trimmedOutput: string = output.trim();

  return trimmedOutput === '' ? '<empty>' : trimmedOutput;
}

export async function readSelfHostedDiagnostics(): Promise<string> {
  if (process.env[selfHostedUserSetupEnabledEnvName] !== '1') {
    return '';
  }

  const result: SelfHostedUserSetupCommandResult = await runCommand({
    argv: ['sudo', '-n', 'sh', '-c', buildSelfHostedDiagnosticsScript()],
    timeoutMs: selfHostedUserSetupDiagnosticsTimeoutMs,
  });

  return `diagnostics exit code: ${result.exitCode.toString()}
diagnostics stderr:
${formatCommandOutput(result.stderr)}
diagnostics stdout:
${formatCommandOutput(result.stdout)}`;
}

function formatDiagnostics(diagnostics: string): string {
  return diagnostics === '' ? '' : `\n\nself-hosted diagnostics:\n${diagnostics}`;
}

function buildSelfHostedDiagnosticsScript(): string {
  return `
set -eu
if [ ! -f /etc/compartment/.env.self-hosted ] || [ ! -f /etc/compartment/docker-compose.self-hosted.yml ]; then
  echo "install files missing"
  exit 0
fi
${selfHostedComposeFilesScript}
compose="${selfHostedDockerComposeCommand}"
echo "## compose ps"
$compose ps
builder_container_id="$($compose ps -q builder || true)"
if [ -n "$builder_container_id" ]; then
  echo "## builder inspect"
  docker inspect --format 'status={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} exit={{.State.ExitCode}} error={{.State.Error}}' "$builder_container_id" || true
fi
for service in builder registry postgres api worker edge caddy; do
  echo "## $service logs"
  $compose logs --no-color --tail=120 "$service" || true
done
${renderNodeAgentLogDiagnosticsScript()}
`;
}

function renderNodeAgentLogDiagnosticsScript(): string {
  const logPath: string | undefined = process.env[selfHostedUserSetupNodeAgentLogPathEnvName];
  if (logPath === undefined || logPath.trim() === '') {
    return '';
  }

  return `echo "## node-agent logs"
if [ -f ${quoteShellSingle(logPath)} ]; then
  tail -n 120 ${quoteShellSingle(logPath)} || true
else
  echo "node-agent log missing at ${logPath}"
fi
if docker ps -a --format '{{.Names}}' | grep -qx 'compartment-node-agent-socket-proxy-e2e'; then
  echo "## node-agent dind proxy logs"
  docker logs --tail=120 compartment-node-agent-socket-proxy-e2e || true
fi`;
}

function quoteShellSingle(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function appendCappedOutput(output: string, chunk: string): string {
  const nextOutput: string = output + chunk;
  return nextOutput.length <= selfHostedUserSetupOutputLimit
    ? nextOutput
    : nextOutput.slice(-selfHostedUserSetupOutputLimit);
}

function clearCommandTimeouts(timeout: NodeJS.Timeout, forceKillTimeout: NodeJS.Timeout | null): void {
  clearTimeout(timeout);
  if (forceKillTimeout !== null) {
    clearTimeout(forceKillTimeout);
  }
}

export function splitCliCommandLine(commandLine: string): string[] {
  return new CliCommandLineSplitter(commandLine).split();
}

class CliCommandLineSplitter {
  readonly #commandLine: string;
  readonly #args: string[] = [];
  #currentArg: string = '';
  #escaping: boolean = false;
  #quote: '"' | "'" | null = null;

  constructor(commandLine: string) {
    this.#commandLine = commandLine;
  }

  split(): string[] {
    for (const character of this.#commandLine.trim()) {
      this.#readCharacter(character);
    }

    this.#assertComplete();
    this.#pushCurrentArg();
    return this.#args;
  }

  #readCharacter(character: string): void {
    if (this.#escaping) {
      this.#appendEscapedCharacter(character);
      return;
    }
    if (character === '\\') {
      this.#escaping = true;
      return;
    }
    if (this.#quote !== null) {
      this.#readQuotedCharacter(character);
      return;
    }
    if (character === '"' || character === "'") {
      this.#quote = character;
      return;
    }
    if (/\s/u.test(character)) {
      this.#pushCurrentArg();
      return;
    }

    this.#currentArg += character;
  }

  #appendEscapedCharacter(character: string): void {
    this.#currentArg += character;
    this.#escaping = false;
  }

  #readQuotedCharacter(character: string): void {
    if (character === this.#quote) {
      this.#quote = null;
      return;
    }

    this.#currentArg += character;
  }

  #pushCurrentArg(): void {
    if (this.#currentArg === '') {
      return;
    }

    this.#args.push(this.#currentArg);
    this.#currentArg = '';
  }

  #assertComplete(): void {
    if (this.#escaping) {
      throw new Error(`Invalid CLI command line with trailing escape: ${this.#commandLine}`);
    }
    if (this.#quote !== null) {
      throw new Error(`Invalid CLI command line with unterminated quote: ${this.#commandLine}`);
    }
  }
}
