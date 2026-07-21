import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  findContentViolations,
  findMigrationSnapshotViolations,
  findPathViolations,
  listRepositoryPaths,
} from './check-kubernetes-cutover.mjs';

const temporaryDirectories = [];
const guardedRuntimeTerms = [
  'node|SocketPath',
  'container|Id',
  'drainingContainer|Id',
  'runtime|-network',
  'DOCKER|-USER',
  'unless|-stopped',
  'or |draining',
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
  'resource|.internal',
  'Node|-backed',
  'inside |Docker',
  'install one Compartment runtime on a |server',
  'CLI creates and repairs that host |directory',
  '/install-operate/install-|domain/',
  'Release executes on the target |node',
  'Node owns release |execution',
  'Runtime packages such as `|node`',
  'defaultRegistry|ImageTag',
  '--default-registry-|image-tag',
  'COMPARTMENT|API|IMAGE',
  'COMPARTMENT|EDGE|IMAGE',
  'COMPARTMENT|CADDY|IMAGE',
  'COMPARTMENT|POSTGRES|DB',
  'COMPARTMENT|POSTGRES|USER',
  'Owns Kubernetes installation |resource lifecycle',
  'restart |behavior',
  'Bootstrapped self-hosted |runtime',
  'Updated self-hosted |runtime',
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

  it('rejects the removed legacy restart policy everywhere', () => {
    const legacyRestartPolicy = ['unless', '-stopped'].join('');

    expect(
      findContentViolations('packages/contracts/src/contracts/service-run.contract.ts', legacyRestartPolicy),
    ).toEqual([
      `packages/contracts/src/contracts/service-run.contract.ts: contains forbidden runtime term ${legacyRestartPolicy}`,
    ]);
    expect(findContentViolations('packages/worker/src/runtime.ts', legacyRestartPolicy)).toEqual([
      `packages/worker/src/runtime.ts: contains forbidden runtime term ${legacyRestartPolicy}`,
    ]);
  });

  it.each([
    '.github/workflows/_system-user-flow-e2e.yml',
    'docker-compose.self-hosted.yml',
    'packages/node/package.json',
    'packages/cli/src/docker-install.ts',
    'packages/cli/src/node-agent-service.ts',
  ])('rejects deleted runtime path %s', (path) => {
    expect(findPathViolations(path)).toEqual([`${path}: legacy runtime path remains tracked`]);
  });

  it.each([
    'public.nodes',
    'node_id',
    'container_id',
    'draining_container_id',
    'upstream_host',
    'upstream_port',
    'runtime_kind',
    'restart_policy',
    'hostname',
  ])('rejects legacy schema term %s in the migration snapshot', (term) => {
    expect(findMigrationSnapshotViolations('packages/api/drizzle/meta/0000_snapshot.json', term)).toContain(
      `packages/api/drizzle/meta/0000_snapshot.json: contains legacy schema term ${term}`,
    );
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
