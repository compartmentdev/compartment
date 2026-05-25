import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '../../..');
const tsxCliPath = require.resolve('tsx/cli');
const implementationPath = resolve(repositoryRoot, 'packages/edge/scripts/sync-caddyfile.impl.ts');

const result = spawnSync(process.execPath, [tsxCliPath, implementationPath, ...process.argv.slice(2)], {
  cwd: resolve(repositoryRoot, 'packages/edge'),
  env: process.env,
  stdio: 'inherit',
});

if (result.error !== undefined) {
  throw result.error;
}

if (result.signal !== null) {
  process.kill(process.pid, result.signal);
} else {
  process.exit(result.status ?? 1);
}
