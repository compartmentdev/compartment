import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { runCommand } from '../lib/command.mjs';
import { readRepositoryRoot } from '../lib/repository-root.mjs';

const repositoryRoot = readRepositoryRoot(import.meta.url, 2);
const ensureRegistryScriptPath = fileURLToPath(new URL('./ensure-dev-artifact-registry.mjs', import.meta.url));
const runCaddyScriptPath = fileURLToPath(new URL('./run-caddy.mjs', import.meta.url));
const turboDevArgs = [
  'exec',
  'turbo',
  'run',
  'dev',
  '--filter=@compartment/console',
  '--filter=@compartment/api',
  '--filter=@compartment/worker',
  '--filter=@compartment/edge',
];

await main();

async function main() {
  runCommand('pnpm', ['db:migrate'], repositoryRoot);
  runCommand(process.execPath, [ensureRegistryScriptPath], repositoryRoot);

  const caddyProcess = spawn(process.execPath, [runCaddyScriptPath], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: 'inherit',
  });
  const turboProcess = spawn('pnpm', turboDevArgs, {
    cwd: repositoryRoot,
    env: process.env,
    stdio: 'inherit',
  });

  let shuttingDown = false;
  const shutdown = async (exitCode = 0) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    await Promise.all([stopChild(turboProcess), stopChild(caddyProcess)]);
    process.exit(exitCode);
  };

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      void shutdown(0);
    });
  }

  const firstExit = await Promise.race([waitForExit(caddyProcess, 'caddy'), waitForExit(turboProcess, 'turbo')]);

  if (firstExit.name === 'caddy') {
    await stopChild(turboProcess);
    throw new Error(readExitMessage(firstExit));
  }

  await stopChild(caddyProcess);
  exitFromChild(firstExit);
}

function waitForExit(childProcess, name) {
  return new Promise((resolve, reject) => {
    childProcess.once('error', reject);
    childProcess.once('exit', (code, signal) => {
      resolve({
        code,
        name,
        signal,
      });
    });
  });
}

async function stopChild(childProcess) {
  if (childProcess.exitCode !== null || childProcess.signalCode !== null) {
    return;
  }

  const exitPromise = waitForExit(childProcess, 'child');
  childProcess.kill('SIGTERM');
  await Promise.race([
    exitPromise,
    new Promise((resolve) => setTimeout(resolve, 5_000)).then(() => {
      if (childProcess.exitCode === null && childProcess.signalCode === null) {
        childProcess.kill('SIGKILL');
      }
    }),
  ]);
  await exitPromise;
}

function readExitMessage(exit) {
  if (exit.signal !== null) {
    return `${exit.name} exited unexpectedly after signal ${exit.signal}.`;
  }

  return `${exit.name} exited unexpectedly with code ${exit.code ?? 1}.`;
}

function exitFromChild(exit) {
  if (exit.signal !== null) {
    process.exit(1);
  }

  process.exit(exit.code ?? 1);
}
