import { spawn, spawnSync } from 'node:child_process';

export async function runCommandAsync(file, args, cwd, env) {
  await new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(file, args, {
      cwd,
      env,
      stdio: 'inherit',
    });

    child.once('error', rejectCommand);
    child.once('close', (status) => {
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
  const result = spawnSync(file, args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  if (result.error !== undefined) {
    throw result.error;
  }

  if (result.status === 0) {
    return result.stdout.trim();
  }

  throw new Error(`Command failed: ${[file, ...args].join(' ')}`);
}
