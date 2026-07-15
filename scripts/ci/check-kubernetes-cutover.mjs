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
];

const forbiddenPathPrefixes = [
  ['docker', '-compose.self-hosted'].join(''),
  ['packages/', 'node/'].join(''),
  ['packages/cli/src/', 'docker-'].join(''),
  ['packages/cli/src/', ['node', 'agent'].join('-')].join(''),
];

export function main() {
  const repositoryRoot = readRepositoryRoot(import.meta.url, 2);
  const violations = listRepositoryPaths(repositoryRoot).flatMap((path) => {
    if (!existsSync(join(repositoryRoot, path))) {
      return [];
    }

    if (forbiddenPathPrefixes.some((prefix) => path.startsWith(prefix))) {
      return [`${path}: legacy runtime path remains tracked`];
    }

    return findFileViolations(repositoryRoot, path);
  });

  if (violations.length > 0) {
    throw new Error(`Kubernetes cutover gate failed:\n${violations.join('\n')}`);
  }

  process.stdout.write('Kubernetes cutover gate passed with no legacy runtime references.\n');
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
  return findContentViolations(path, contents);
}

export function findContentViolations(path, contents) {
  return forbiddenRuntimeTerms.flatMap((term) =>
    contents.includes(term) ? [`${path}: contains forbidden runtime term ${term}`] : [],
  );
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main();
}
