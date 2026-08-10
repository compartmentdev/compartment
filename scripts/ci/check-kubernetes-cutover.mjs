import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

import { readRepositoryRoot } from '../lib/repository-root.mjs';
import { runMain } from '../lib/run-main.mjs';

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
  ['https://compartment.dev', '/k/install.sh'].join(''),
];

const forbiddenRemovedTopologyTerms = [
  ['registry', '-mirror'].join(''),
  ['skip', '-registry', '-mirror'].join(''),
  ['registries', '.', 'yaml'].join(''),
  ['custom', '-cert'].join(''),
  ['custom', '-http'].join(''),
  ['on', '-demand'].join(''),
  ['attach', '-cert'].join(''),
  ['ports', '.', 'https'].join(''),
  ['existing', 'Cluster'].join(''),
  ['custom', 'Tls'].join(''),
  ['custom', '-tls'].join(''),
  ['pending', '_caddy', '_mode'].join(''),
  ['pending', '_certificate', '_metadata', '_json'].join(''),
  ['pending', '_certificate', '_path'].join(''),
  ['pending', '_private', '_key', '_path'].join(''),
  ['pending', '_tls', '_secret', '_name'].join(''),
  ['active', '-custom', '-tls', '-secret'].join(''),
  ['operator', '-custom', '-tls', '-secret'].join(''),
  ['COMPARTMENT', 'PUBLIC', 'INGRESS', 'IPV4'].join('_'),
  ['COMPARTMENT', 'PUBLIC', 'INGRESS', 'IPV6'].join('_'),
  ['COMPARTMENT', 'CADDY', 'HTTPS', 'PORT'].join('_'),
  ['COMPARTMENT', 'CUSTOM', 'TLS'].join('_'),
  ['COMPARTMENT', 'CADDY', 'BUILDER', 'IMAGE'].join('_'),
  ['COMPARTMENT', 'ACME', 'ISSUER'].join('_'),
  ['COMPARTMENT', 'ACME', 'CA', 'URL'].join('_'),
  ['COMPARTMENT', 'ACME', 'EMAIL'].join('_'),
  ['COMPARTMENT', 'ARTIFACT', 'REGISTRY', 'INTERNAL', 'PORT'].join('_'),
  ['caddy', '-dns-compartment-broker'].join(''),
  ['x', 'caddy'].join(''),
  ['public', 'Ingress', 'Ipv4'].join(''),
  ['public', 'Ingress', 'Ipv6'].join(''),
  ['--disable ', 'traefik'].join(''),
  ['execute', 'Legacy', 'Kubernetes', 'Install', 'Command'].join(''),
  ['materialize', 'Adopted', 'Kubernetes', 'Install'].join(''),
];

const forbiddenPathPrefixes = [
  ['.github/workflows/', '_system-user-flow-e2e.yml'].join(''),
  ['docker', '-compose.self-hosted'].join(''),
  ['packages/', 'node/'].join(''),
  ['packages/cli/src/', 'docker-'].join(''),
  ['packages/cli/src/', ['node', 'agent'].join('-')].join(''),
  ['packages/cli/src/services/', ['kubernetes', 'install', 'adoption.service.ts'].join('-')].join(''),
];

const canonicalRemovalSpecificationPath = 'docs/specs/existing-kubernetes-install.md';
const canonicalCaddyDockerfilePath = 'packages/edge/Dockerfile.caddy.self-hosted';
const publicInstallerPath = 'install.sh';
export const publicInstallerRequiredTerms = [
  ['channel=', '"latest"'].join(''),
  ['https://compartment.dev', '/install.sh'].join(''),
  ['publish-self-hosted-', 'main.yml@refs/heads/main'].join(''),
  ['"', '$cosign_command', '" verify'].join(''),
  ['--certificate-', 'identity'].join(''),
  ['--certificate-', 'oidc-issuer'].join(''),
  ['--certificate-', 'github-workflow-sha'].join(''),
];
const canonicalCaddyBuildTerms = new Set([
  ['COMPARTMENT', 'CADDY', 'BUILDER', 'IMAGE'].join('_'),
  ['x', 'caddy'].join(''),
]);
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
  const repositoryPaths = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: withoutGitRepositoryEnvironment(),
  })
    .split('\0')
    .filter((path) => path !== '');

  return [...new Set([...repositoryPaths, ...listGeneratedArtifactPaths(repositoryRoot)])];
}

function listGeneratedArtifactPaths(repositoryRoot) {
  const packagesRoot = join(repositoryRoot, 'packages');
  const generatedRoots = [
    ...(existsSync(packagesRoot)
      ? readdirSync(packagesRoot, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => join(packagesRoot, entry.name, 'dist'))
      : []),
    join(repositoryRoot, '.compartment', 'release-assets'),
  ];

  return generatedRoots.flatMap((root) => listTextArtifactPaths(repositoryRoot, root));
}

function listTextArtifactPaths(repositoryRoot, root) {
  if (!existsSync(root)) {
    return [];
  }

  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && isTextArtifact(entry.name))
    .map((entry) => relative(repositoryRoot, join(entry.parentPath, entry.name)));
}

function isTextArtifact(fileName) {
  return new Set(['.cjs', '.html', '.js', '.json', '.md', '.mjs', '.sh', '.txt', '.yaml', '.yml']).has(
    extname(fileName),
  );
}

function withoutGitRepositoryEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
}

function findFileViolations(repositoryRoot, path) {
  if (path === canonicalRemovalSpecificationPath) {
    return [];
  }
  const contents = readFileSync(join(repositoryRoot, path), 'utf8');
  return [
    ...findContentViolations(path, contents),
    ...findMigrationSnapshotViolations(path, contents),
    ...findPublicInstallerViolations(path, contents),
  ];
}

export function findPublicInstallerViolations(path, contents) {
  if (path !== publicInstallerPath) {
    return [];
  }

  const violations = publicInstallerRequiredTerms.flatMap((term) =>
    contents.includes(term) ? [] : [`${path}: public Kubernetes installer is missing required trust term ${term}`],
  );
  if (contents.includes(['raw.', 'githubusercontent.com'].join(''))) {
    violations.push(`${path}: public installer must not resolve through a raw branch URL`);
  }
  return violations;
}

export function findMigrationSnapshotViolations(path, contents) {
  if (!/^packages\/[^/]+\/drizzle\/meta\/\d+_snapshot\.json$/u.test(path)) {
    return [];
  }
  return forbiddenMigrationSnapshotTerms.flatMap((term) =>
    contents.includes(term) ? [`${path}: contains legacy schema term ${term}`] : [],
  );
}

export function findContentViolations(path, contents) {
  const guardedTerms = [...forbiddenRuntimeTerms, ...forbiddenRemovedTopologyTerms];
  const terms =
    path === canonicalCaddyDockerfilePath
      ? guardedTerms.filter((term) => !canonicalCaddyBuildTerms.has(term))
      : guardedTerms;
  return terms.flatMap((term) => (contents.includes(term) ? [`${path}: contains forbidden runtime term ${term}`] : []));
}

runMain(import.meta.url, process.argv[1], main);
