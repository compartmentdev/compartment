import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findContentViolations, listRepositoryPaths } from './check-kubernetes-cutover.mjs';

const temporaryDirectories = [];
const guardedRuntimeTerms = [
  'node|SocketPath',
  'container|Id',
  'drainingContainer|Id',
  'runtime|-network',
  'DOCKER|-USER',
  'unless|-stopped',
  'node|Id',
  'COMPARTMENT|DOCKER|WORK|DIR',
  'COMPARTMENT|NODE|AGENT|SOCKET',
  'COMPARTMENT|NODE|APP|PORT|START',
  'COMPARTMENT|NODE|APP|PORT|END',
  'COMPARTMENT|NODE|NAME',
  'COMPARTMENT|NODE|VERSION',
  'COMPARTMENT|RUNTIME|CONNECTIVITY|MODE',
  'COMPARTMENT|RUNTIME|DEFAULT|UPSTREAM|HOST',
  'COMPARTMENT|RUNTIME|NETWORK|POOL|CIDR',
  'COMPARTMENT|RUNTIME|NETWORK|SUBNET|PREFIX',
  'COMPARTMENT|RESOURCE|BACKUP|DIR',
].map((term) => term.replaceAll('|', term.startsWith('COMPARTMENT') ? '_' : ''));

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe('Kubernetes cutover gate', () => {
  it.each(guardedRuntimeTerms)('rejects legacy runtime term %s', (term) => {
    expect(findContentViolations('fixture.txt', term)).toEqual([
      `fixture.txt: contains forbidden runtime term ${term}`,
    ]);
  });

  it('includes untracked files in the repository scan', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'compartment-cutover-gate-'));
    const gitEnvironment = Object.fromEntries(
      Object.entries(process.env).filter(([variableName]) => !variableName.startsWith('GIT_')),
    );
    temporaryDirectories.push(repository);
    execFileSync('git', ['init', '--quiet'], { cwd: repository, env: gitEnvironment });
    await writeFile(join(repository, 'tracked.txt'), 'tracked', 'utf8');
    execFileSync('git', ['add', 'tracked.txt'], { cwd: repository, env: gitEnvironment });
    await writeFile(join(repository, 'untracked.txt'), 'untracked', 'utf8');

    expect(listRepositoryPaths(repository).sort()).toEqual(['tracked.txt', 'untracked.txt']);
  });
});
