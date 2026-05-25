import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { compartmentInternalNodeRegistrationPathname } from '@compartment/contracts';

const healthCheckIntervalMs: number = 100;
const processStartupGraceMs: number = 250;
const processStartupTimeoutMs: number = 15_000;
const processStopTimeoutMs: number = 5_000;
const runtimeProcessOutputLimit: number = 4_000;

type RuntimePackageName = 'api' | 'edge' | 'node' | 'worker';

interface RuntimeProcessExitResult {
  code: number | null;
  signal: NodeJS.Signals | null;
}

interface RuntimeProcessOutput {
  stderr: string;
  stdout: string;
}

interface StartRuntimeProcessOptions {
  env: NodeJS.ProcessEnv;
  packageName: RuntimePackageName;
  readyUrl?: string;
}

export interface RuntimeProcessHandle {
  stop(): Promise<void>;
}

class RuntimeProcessHandleImpl implements RuntimeProcessHandle {
  readonly #child: ChildProcess;
  readonly #exitPromise: Promise<RuntimeProcessExitResult>;

  constructor(child: ChildProcess, exitPromise: Promise<RuntimeProcessExitResult>) {
    this.#child = child;
    this.#exitPromise = exitPromise;
  }

  async stop(): Promise<void> {
    await stopRuntimeProcess(this.#child, this.#exitPromise);
  }
}

export async function startRuntimeProcess(options: StartRuntimeProcessOptions): Promise<RuntimeProcessHandle> {
  const packageDirectory: string = resolve(__dirname, '..', '..', options.packageName);
  const processOutput: RuntimeProcessOutput = {
    stderr: '',
    stdout: '',
  };
  let spawnError: Error | null = null;
  const child: ChildProcess = spawn(
    process.execPath,
    [require.resolve('tsx/cli'), '--tsconfig', 'tsconfig.json', 'src/server.ts'],
    {
      cwd: packageDirectory,
      env: {
        ...process.env,
        ...options.env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child.once('error', (error: Error): void => {
    spawnError = error;
  });
  child.stdout?.on('data', (chunk: Buffer | string): void => {
    processOutput.stdout = appendRuntimeProcessOutput(processOutput.stdout, chunk.toString());
  });
  child.stderr?.on('data', (chunk: Buffer | string): void => {
    processOutput.stderr = appendRuntimeProcessOutput(processOutput.stderr, chunk.toString());
  });

  const exitPromise: Promise<RuntimeProcessExitResult> = new Promise<RuntimeProcessExitResult>(
    (resolveExit: (value: RuntimeProcessExitResult | PromiseLike<RuntimeProcessExitResult>) => void): void => {
      child.once('exit', (code: number | null, signal: NodeJS.Signals | null): void => {
        resolveExit({ code, signal });
      });
    },
  );
  const runtimeProcessHandle: RuntimeProcessHandle = new RuntimeProcessHandleImpl(child, exitPromise);

  try {
    if (options.readyUrl === undefined) {
      await waitForRuntimeProcessStartup(child, options.packageName, processOutput, (): Error | null => spawnError);
    } else {
      await waitForRuntimeHttpReadiness(
        child,
        options.packageName,
        options.readyUrl,
        processOutput,
        (): Error | null => spawnError,
      );
    }
  } catch (error) {
    await runtimeProcessHandle.stop();
    if (error instanceof Error) {
      throw error;
    }

    throw new Error('Runtime readiness failed with a non-Error value.');
  }

  return runtimeProcessHandle;
}

export async function refreshEdgeAccessState(apiUrl: string, edgeUrl: string, edgeToken: string): Promise<void> {
  const stateResponse: Response = await fetch(`${apiUrl}/internal/app-access/state`, {
    headers: {
      authorization: `Bearer ${edgeToken}`,
    },
  });
  const statePayload: string = await stateResponse.text();
  ensureSuccessfulResponse(stateResponse, 'Failed to read app access state from API.');

  const refreshResponse: Response = await fetch(`${edgeUrl}/internal/app-access/state`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${edgeToken}`,
      'content-type': 'application/json',
    },
    body: statePayload,
  });
  const refreshPayload: string = await refreshResponse.text();
  ensureSuccessfulResponse(refreshResponse, 'Failed to refresh edge access state.', refreshPayload);
}

export async function registerLocalNodeByUrl(
  apiUrl: string,
  runtimeControlToken: string,
  nodeSocketPath: string,
): Promise<void> {
  const response: Response = await fetch(`${apiUrl}${compartmentInternalNodeRegistrationPathname}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${runtimeControlToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      nodeName: 'local-node',
      nodeSocketPath,
      nodeVersion: '0.1.0',
    }),
  });
  const payload: string = await response.text();
  ensureSuccessfulResponse(response, 'Failed to register the local node in API.', payload);
}

function appendRuntimeProcessOutput(currentOutput: string, nextChunk: string): string {
  const mergedOutput: string = `${currentOutput}${nextChunk}`;
  if (mergedOutput.length <= runtimeProcessOutputLimit) {
    return mergedOutput;
  }

  return mergedOutput.slice(-runtimeProcessOutputLimit);
}

async function waitForRuntimeProcessStartup(
  child: ChildProcess,
  packageName: RuntimePackageName,
  processOutput: RuntimeProcessOutput,
  readSpawnError: () => Error | null,
): Promise<void> {
  await waitForDelay(processStartupGraceMs);
  throwOnRuntimeProcessFailure(child, packageName, processOutput, readSpawnError());
}

async function waitForRuntimeHttpReadiness(
  child: ChildProcess,
  packageName: RuntimePackageName,
  readyUrl: string,
  processOutput: RuntimeProcessOutput,
  readSpawnError: () => Error | null,
): Promise<void> {
  const deadlineAt: number = Date.now() + processStartupTimeoutMs;

  for (;;) {
    throwOnRuntimeProcessFailure(child, packageName, processOutput, readSpawnError());
    if (await isRuntimeHttpReady(readyUrl)) {
      return;
    }
    if (Date.now() >= deadlineAt) {
      throw new Error(
        createRuntimeProcessFailureMessage(packageName, processOutput, `Timed out waiting for ${readyUrl}.`),
      );
    }

    await waitForDelay(healthCheckIntervalMs);
  }
}

async function isRuntimeHttpReady(readyUrl: string): Promise<boolean> {
  try {
    const response: Response = await fetch(readyUrl);

    return response.ok;
  } catch {
    return false;
  }
}

function throwOnRuntimeProcessFailure(
  child: ChildProcess,
  packageName: RuntimePackageName,
  processOutput: RuntimeProcessOutput,
  spawnError: Error | null,
): void {
  if (spawnError !== null) {
    throw new Error(createRuntimeProcessFailureMessage(packageName, processOutput, spawnError.message));
  }

  if (child.exitCode !== null || child.signalCode !== null) {
    throw new Error(
      createRuntimeProcessFailureMessage(
        packageName,
        processOutput,
        `Process exited before becoming ready (code: ${String(child.exitCode)}, signal: ${String(child.signalCode)}).`,
      ),
    );
  }
}

function createRuntimeProcessFailureMessage(
  packageName: RuntimePackageName,
  processOutput: RuntimeProcessOutput,
  reason: string,
): string {
  const stdout: string = processOutput.stdout.trim();
  const stderr: string = processOutput.stderr.trim();
  const stdoutSuffix: string = stdout === '' ? '' : `\nstdout:\n${stdout}`;
  const stderrSuffix: string = stderr === '' ? '' : `\nstderr:\n${stderr}`;

  return `Failed to start ${packageName} runtime process. ${reason}${stdoutSuffix}${stderrSuffix}`;
}

async function stopRuntimeProcess(child: ChildProcess, exitPromise: Promise<RuntimeProcessExitResult>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    await exitPromise;

    return;
  }

  child.kill('SIGTERM');
  const exitedGracefully: boolean = await waitForRuntimeProcessExit(exitPromise, processStopTimeoutMs);
  if (exitedGracefully) {
    return;
  }

  child.kill('SIGKILL');
  await exitPromise;
}

async function waitForRuntimeProcessExit(
  exitPromise: Promise<RuntimeProcessExitResult>,
  timeoutMs: number,
): Promise<boolean> {
  const exitResult: RuntimeProcessExitResult | null = await Promise.race([
    exitPromise,
    waitForDelay(timeoutMs).then((): null => null),
  ]);

  return exitResult !== null;
}

function ensureSuccessfulResponse(response: Response, errorMessage: string, payload?: string): void {
  if (response.ok) {
    return;
  }

  const payloadSuffix: string = payload === undefined || payload === '' ? '' : ` Response body: ${payload}`;
  throw new Error(`${errorMessage} HTTP ${response.status.toString()}.${payloadSuffix}`);
}

async function waitForDelay(timeoutMs: number): Promise<void> {
  await new Promise<void>((resolveDelay: () => void): void => {
    setTimeout(resolveDelay, timeoutMs);
  });
}
