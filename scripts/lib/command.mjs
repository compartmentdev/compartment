import { execFile, spawn, spawnSync } from 'node:child_process';

export async function captureCommandAsync(file, args, cwd, env, options) {
  return await new Promise((resolveCommand, rejectCommand) => {
    execFile(
      file,
      args,
      {
        cwd,
        env,
        killSignal: 'SIGKILL',
        timeout: options.timeoutMs,
      },
      (error, stdout, stderr) => {
        if (error !== null && typeof error.code !== 'number' && error.killed !== true) {
          rejectCommand(error);
          return;
        }
        resolveCommand({
          status: error === null ? 0 : typeof error.code === 'number' ? error.code : null,
          stderr,
          stdout,
          timedOut: error?.killed === true,
        });
      },
    );
  });
}

export async function runCommandAsync(file, args, cwd, env, options = {}) {
  await new Promise((resolveCommand, rejectCommand) => {
    const terminateProcessGroup = options.terminateProcessGroup === true;
    const child = spawn(file, args, {
      cwd,
      detached: terminateProcessGroup,
      env,
      stdio: 'inherit',
    });
    const abort = () => {
      if (child.pid === undefined) {
        return;
      }
      try {
        process.kill(terminateProcessGroup ? -child.pid : child.pid, 'SIGTERM');
      } catch (error) {
        if (error?.code !== 'ESRCH') {
          rejectCommand(error);
        }
      }
    };
    if (options.signal?.aborted === true) {
      abort();
    } else {
      options.signal?.addEventListener('abort', abort, { once: true });
    }

    child.once('error', rejectCommand);
    child.once('close', (status) => {
      options.signal?.removeEventListener('abort', abort);
      if (status === 0) {
        resolveCommand();
        return;
      }

      rejectCommand(new Error(`Command failed: ${[file, ...args].join(' ')}`));
    });
  });
}

export function runCommand(file, args, cwd, env) {
  const result = spawnSync(file, args, {
    cwd,
    env,
    stdio: 'inherit',
  });

  if (result.error !== undefined) {
    throw result.error;
  }

  if (result.status === 0) {
    return;
  }

  throw new Error(`Command failed: ${[file, ...args].join(' ')}`);
}

export function captureCommand(file, args, cwd, env) {
  const result = captureCommandResult(file, args, cwd, env);

  if (result.error !== undefined) {
    throw result.error;
  }

  if (result.status === 0) {
    return result.stdout.trim();
  }

  process.stderr.write(result.stderr);
  throw new Error(`Command failed: ${[file, ...args].join(' ')}`);
}

export function captureCommandResult(file, args, cwd, env) {
  return spawnSync(file, args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
