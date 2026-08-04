import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  findContentViolations,
  findMigrationSnapshotViolations,
  findPathViolations,
  findPublicInstallerViolations,
  listRepositoryPaths,
} from './check-kubernetes-cutover.mjs';

const temporaryDirectories = [];
const renderLines = (lines) => lines.join('\n');
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
  'registry|-mirror',
  'skip|-registry|-mirror',
  'registries|.|yaml',
  'custom|-cert',
  'custom|-http',
  'on|-demand',
  'attach|-cert',
  'ports|.|https',
  'existing|Cluster',
  'custom|Tls',
  'custom|-tls',
  'pending|_caddy|_mode',
  'pending|_certificate|_metadata|_json',
  'pending|_certificate|_path',
  'pending|_private|_key|_path',
  'pending|_tls|_secret|_name',
  'active|-custom|-tls|-secret',
  'operator|-custom|-tls|-secret',
  'COMPARTMENT|PUBLIC|INGRESS|IPV4',
  'COMPARTMENT|PUBLIC|INGRESS|IPV6',
  'COMPARTMENT|CADDY|HTTPS|PORT',
  'COMPARTMENT|CUSTOM|TLS',
  'COMPARTMENT|CADDY|BUILDER|IMAGE',
  'COMPARTMENT|ACME|ISSUER',
  'COMPARTMENT|ACME|CA|URL',
  'COMPARTMENT|ACME|EMAIL',
  'COMPARTMENT|ARTIFACT|REGISTRY|INTERNAL|PORT',
  'caddy|-dns-compartment-broker',
  'x|caddy',
  'public|Ingress|Ipv4',
  'public|Ingress|Ipv6',
  '--disable |traefik',
].map((term) => term.replaceAll('|', term.startsWith('COMPARTMENT') ? '_' : ''));

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe('Kubernetes cutover gate', () => {
  it.each(guardedRuntimeTerms)('rejects legacy runtime term %s', (term) => {
    expect(findContentViolations('fixture.txt', term)).toContain(
      `fixture.txt: contains forbidden runtime term ${term}`,
    );
  });

  it('rejects removed topology fields in every migration artifact', () => {
    const removedField = ['pending', '_tls', '_secret', '_name'].join('');

    expect(findContentViolations('packages/api/drizzle/meta/0005_snapshot.json', removedField)).toEqual([
      `packages/api/drizzle/meta/0005_snapshot.json: contains forbidden runtime term ${removedField}`,
    ]);
    expect(findContentViolations('packages/api/drizzle/0005_cutover.sql', removedField)).toEqual([
      `packages/api/drizzle/0005_cutover.sql: contains forbidden runtime term ${removedField}`,
    ]);
  });

  it('allows the canonical Caddy builder terms only in the self-hosted Caddy Dockerfile', () => {
    const contents = renderLines([['COMPARTMENT', 'CADDY', 'BUILDER', 'IMAGE'].join('_'), ['x', 'caddy'].join('')]);

    expect(findContentViolations('packages/edge/Dockerfile.caddy.self-hosted', contents)).toEqual([]);
    expect(findContentViolations('packages/edge/legacy.txt', contents)).toHaveLength(2);
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

  it('includes ignored generated package artifacts in the repository scan', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'compartment-cutover-artifacts-'));
    const gitEnvironment = Object.fromEntries(
      Object.entries(process.env).filter(([variableName]) => !variableName.startsWith('GIT_')),
    );
    temporaryDirectories.push(repository);
    execFileSync('git', ['init', '--quiet'], { cwd: repository, env: gitEnvironment });
    await writeFile(join(repository, '.gitignore'), 'packages/*/dist/\n', 'utf8');
    await mkdir(join(repository, 'packages', 'cli', 'dist'), { recursive: true });
    await writeFile(join(repository, 'packages', 'cli', 'dist', 'installer.js'), 'generated', 'utf8');
    execFileSync('git', ['add', '.gitignore'], { cwd: repository, env: gitEnvironment });

    expect(listRepositoryPaths(repository)).toContain('packages/cli/dist/installer.js');
  });

  it('requires the public bootstrap to default to the signed Kubernetes artifact', () => {
    const validInstaller = renderLines([
      ['channel=', '"kubernetes"'].join(''),
      ['https://compartment.dev', '/install.sh'].join(''),
      ['"', '$cosign_command', '" verify'].join(''),
      ['--certificate-', 'identity'].join(''),
      ['--certificate-', 'oidc-issuer'].join(''),
      ['--certificate-', 'github-workflow-sha'].join(''),
    ]);

    expect(findPublicInstallerViolations('install.sh', validInstaller)).toEqual([]);
    expect(findPublicInstallerViolations('install.sh', 'channel="latest"')).toHaveLength(6);
    expect(
      findPublicInstallerViolations(
        'install.sh',
        `${validInstaller}\nhttps://${['raw.', 'githubusercontent.com'].join('')}/owner/repo/main/install.sh`,
      ),
    ).toContain('install.sh: public installer must not resolve through a raw branch URL');
  });
});
