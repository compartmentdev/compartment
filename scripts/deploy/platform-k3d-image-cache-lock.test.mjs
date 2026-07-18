import { execFile, spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const temporaryDirectories = [];
const repositoryRoot = new URL('../..', import.meta.url).pathname;
const managerPath = join(repositoryRoot, 'scripts/deploy/manage-platform-image-cache-lock.mjs');
const supportUrl = new URL('./platform-k3d-e2e-support.mjs', import.meta.url).href;

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe('platform image cache Docker lock', () => {
  it('waits for the current owner and releases only with the matching token', async () => {
    const fixture = await createDockerFixture();
    await runManager(fixture.env, 'acquire', 'owner-a');
    await expect(runManager(fixture.env, 'release', 'owner-b')).rejects.toThrow('Command failed');

    const waiting = spawn(process.execPath, [managerPath, 'acquire', 'owner-b'], { env: fixture.env, stdio: 'ignore' });
    const waitingExit = new Promise((resolveExit) => waiting.once('exit', resolveExit));
    await new Promise((resolveDelay) => globalThis.setTimeout(resolveDelay, 200));
    expect(waiting.exitCode).toBe(null);
    await runManager(fixture.env, 'release', 'owner-a');
    await expect(waitingExit).resolves.toBe(0);
    await runManager(fixture.env, 'release', 'owner-b');
  });

  it('recovers a stale owned lock and refuses an unowned network', async () => {
    const fixture = await createDockerFixture();
    await writeFile(
      fixture.statePath,
      JSON.stringify({
        Created: new Date(Date.now() - 31 * 60 * 1_000).toISOString(),
        Labels: {
          'compartment.image-cache-lock': 'true',
          'compartment.image-cache-lock-owner': 'stale-owner',
        },
      }),
    );
    await runManager(fixture.env, 'acquire', 'new-owner');
    expect(JSON.parse(await readFile(fixture.statePath, 'utf8')).Labels['compartment.image-cache-lock-owner']).toBe(
      'new-owner',
    );
    await runManager(fixture.env, 'release', 'new-owner');

    await writeFile(fixture.statePath, JSON.stringify({ Created: new Date(0).toISOString(), Labels: {} }));
    await expect(runManager(fixture.env, 'release', 'new-owner')).rejects.toThrow('Command failed');
    await expect(readFile(fixture.statePath, 'utf8')).resolves.toContain('Labels');
  });

  it('releases the owned lock when the protected operation fails', async () => {
    const fixture = await createDockerFixture();
    const program = `
import { withPlatformImageCacheDockerLock } from ${JSON.stringify(supportUrl)};
await withPlatformImageCacheDockerLock(async () => { throw new Error('operation failed'); });
`;
    await expect(
      execFileAsync(process.execPath, ['--input-type=module', '--eval', program], { env: fixture.env }),
    ).rejects.toThrow('Command failed');
    await expect(readFile(fixture.statePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

async function runManager(env, action, ownerToken) {
  await execFileAsync(process.execPath, [managerPath, action, ownerToken], { env });
}

async function createDockerFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'platform-image-lock-'));
  const binaryDirectory = join(directory, 'bin');
  const statePath = join(directory, 'network.json');
  temporaryDirectories.push(directory);
  await mkdir(binaryDirectory);
  await writeFile(
    join(binaryDirectory, 'docker'),
    `#!/usr/bin/env node
import { readFile, rm, writeFile } from 'node:fs/promises';
const statePath = process.env.PLATFORM_IMAGE_LOCK_STATE;
const [resource, action, ...args] = process.argv.slice(2);
if (resource !== 'network') process.exit(2);
if (action === 'create') {
  try { await readFile(statePath); process.exit(1); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const labels = {};
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--label') {
      const [name, value] = args[index + 1].split('=');
      labels[name] = value;
      index += 1;
    }
  }
  await writeFile(statePath, JSON.stringify({ Created: new Date().toISOString(), Labels: labels }));
  process.stdout.write('lock-id');
} else if (action === 'inspect') {
  try { process.stdout.write(await readFile(statePath, 'utf8')); } catch (error) { if (error.code === 'ENOENT') process.exit(1); throw error; }
} else if (action === 'rm') {
  await rm(statePath, { force: true });
} else {
  process.exit(2);
}
`,
    { mode: 0o755 },
  );
  return {
    env: {
      ...process.env,
      PATH: `${binaryDirectory}:${process.env.PATH}`,
      PLATFORM_IMAGE_LOCK_STATE: statePath,
    },
    statePath,
  };
}
