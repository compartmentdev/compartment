import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

import { readRepositoryRoot } from '../lib/repository-root.mjs';

const repositoryRoot = readRepositoryRoot(import.meta.url, 2);

function main() {
  readRequiredEnv('COMPARTMENT_BASE_DOMAIN');

  const caddyProcess = spawn(
    'caddy',
    ['run', '--config', resolve(repositoryRoot, 'packages/edge/Caddyfile'), '--adapter', 'caddyfile'],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        XDG_CONFIG_HOME: resolve(repositoryRoot, '.compartment/caddy/config'),
        XDG_DATA_HOME: resolve(repositoryRoot, '.compartment/caddy/data'),
      },
      stdio: 'inherit',
    },
  );

  let forwardedSignal = null;
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      forwardedSignal = signal;
      if (caddyProcess.exitCode === null && caddyProcess.signalCode === null) {
        caddyProcess.kill(signal);
      }
    });
  }

  caddyProcess.once('error', (error) => {
    throw error;
  });
  caddyProcess.once('exit', (code, signal) => {
    if (signal !== null) {
      process.exit(signal === forwardedSignal ? 0 : 1);
    }

    process.exit(code ?? 1);
  });
}

function readRequiredEnv(name) {
  const value = process.env[name]?.trim();
  if (value !== undefined && value !== '') {
    return value;
  }

  throw new Error(`Expected ${name} to be set in .env before running pnpm dev:caddy.`);
}

main();
