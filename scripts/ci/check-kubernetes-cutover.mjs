import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readRepositoryRoot } from '../lib/repository-root.mjs';

const forbiddenRuntimeTerms = [
  ['node', 'SocketPath'].join(''),
  ['container', 'Id'].join(''),
  ['drainingContainer', 'Id'].join(''),
  ['runtime', '-network'].join(''),
  ['DOCKER', '-USER'].join(''),
  ['unless', '-stopped'].join(''),
  ['node', 'Id'].join(''),
  ['starting', '_candidate'].join(''),
  ['checking', '_readiness'].join(''),
  ['switching', '_route'].join(''),
  ['draining', '_previous'].join(''),
  ['or ', 'draining'].join(''),
  ['COMPARTMENT', 'DOCKER', 'WORK', 'DIR'].join('_'),
  ['COMPARTMENT', 'NODE', 'AGENT', 'SOCKET'].join('_'),
  ['COMPARTMENT', 'NODE', 'APP', 'PORT', 'START'].join('_'),
  ['COMPARTMENT', 'NODE', 'APP', 'PORT', 'END'].join('_'),
  ['COMPARTMENT', 'NODE', 'NAME'].join('_'),
  ['COMPARTMENT', 'NODE', 'VERSION'].join('_'),
  ['COMPARTMENT', 'RUNTIME', 'CONNECTIVITY', 'MODE'].join('_'),
  ['COMPARTMENT', 'RUNTIME', 'DEFAULT', 'UPSTREAM', 'HOST'].join('_'),
  ['COMPARTMENT', 'RUNTIME', 'NETWORK', 'POOL', 'CIDR'].join('_'),
  ['COMPARTMENT', 'RUNTIME', 'NETWORK', 'SUBNET', 'PREFIX'].join('_'),
  ['COMPARTMENT', 'RESOURCE', 'BACKUP', 'DIR'].join('_'),
  ['resource', '.internal'].join(''),
  ['Node', '-backed'].join(''),
  ['inside ', 'Docker'].join(''),
  ['install one Compartment runtime on a ', 'server'].join(''),
  ['CLI creates and repairs that host ', 'directory'].join(''),
  ['/install-operate/install-', 'domain/'].join(''),
  ['Release executes on the target ', 'node'].join(''),
  ['Node owns release ', 'execution'].join(''),
  ['Runtime packages such as `', 'node`'].join(''),
  ['defaultRegistry', 'ImageTag'].join(''),
  ['--default-registry-', 'image-tag'].join(''),
  ['COMPARTMENT', 'API', 'IMAGE'].join('_'),
  ['COMPARTMENT', 'EDGE', 'IMAGE'].join('_'),
  ['COMPARTMENT', 'CADDY', 'IMAGE'].join('_'),
  ['COMPARTMENT', 'POSTGRES', 'DB'].join('_'),
  ['COMPARTMENT', 'POSTGRES', 'USER'].join('_'),
  ['Owns Kubernetes installation ', 'resource lifecycle'].join(''),
  ['restart ', 'behavior'].join(''),
  ['Bootstrapped self-hosted ', 'runtime'].join(''),
  ['Updated self-hosted ', 'runtime'].join(''),
  ['runtime ', 'verifier'].join(''),
];

const forbiddenPathPrefixes = [
  ['.github/workflows/', '_system-user-flow-e2e.yml'].join(''),
  ['docker', '-compose.self-hosted'].join(''),
  ['packages/', 'node/'].join(''),
  ['packages/cli/src/', 'docker-'].join(''),
  ['packages/cli/src/', ['node', 'agent'].join('-')].join(''),
];

const migrationSnapshotPath = 'packages/api/drizzle/meta/0000_snapshot.json';
const forbiddenMigrationSnapshotTerms = [
  ['public.', 'nodes'].join(''),
  ['node', 'id'].join('_'),
  ['container', 'id'].join('_'),
  ['draining', 'container', 'id'].join('_'),
  ['upstream', 'host'].join('_'),
  ['upstream', 'port'].join('_'),
  ['runtime', 'kind'].join('_'),
  ['restart', 'policy'].join('_'),
  ['host', 'name'].join(''),
];

export function main() {
  const repositoryRoot = readRepositoryRoot(import.meta.url, 2);
  const violations = listRepositoryPaths(repositoryRoot).flatMap((path) => {
    if (!existsSync(join(repositoryRoot, path))) {
      return [];
    }

    const pathViolations = findPathViolations(path);
    if (pathViolations.length > 0) {
      return pathViolations;
    }

    return findFileViolations(repositoryRoot, path);
  });

  if (violations.length > 0) {
    throw new Error(`Kubernetes cutover gate failed:\n${violations.join('\n')}`);
  }

  process.stdout.write('Kubernetes cutover gate passed with no legacy runtime references.\n');
}

export function findPathViolations(path) {
  return forbiddenPathPrefixes.some((prefix) => path.startsWith(prefix))
    ? [`${path}: legacy runtime path remains tracked`]
    : [];
}

export function listRepositoryPaths(repositoryRoot) {
  return execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: withoutGitRepositoryEnvironment(),
  })
    .split('\0')
    .filter((path) => path !== '');
}

function withoutGitRepositoryEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
}

function findFileViolations(repositoryRoot, path) {
  const contents = readFileSync(join(repositoryRoot, path), 'utf8');
  return [...findContentViolations(path, contents), ...findMigrationSnapshotViolations(path, contents)];
}

export function findMigrationSnapshotViolations(path, contents) {
  if (path !== migrationSnapshotPath) {
    return [];
  }
  return forbiddenMigrationSnapshotTerms.flatMap((term) =>
    contents.includes(term) ? [`${path}: contains legacy schema term ${term}`] : [],
  );
}

export function findContentViolations(path, contents) {
  return forbiddenRuntimeTerms.flatMap((term) =>
    contents.includes(term) ? [`${path}: contains forbidden runtime term ${term}`] : [],
  );
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main();
}
