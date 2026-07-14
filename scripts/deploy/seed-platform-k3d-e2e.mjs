import { appendFile, chmod, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { readRepositoryRoot } from '../lib/repository-root.mjs';
import { runMain } from '../lib/run-main.mjs';

const repositoryRoot = readRepositoryRoot(import.meta.url, 2);
const platformUrl = 'http://console.compartment.localhost:18080';
const platformBaseDomain = 'compartment.localhost';
const seedOrganizationSlug = 'platform-e2e';
const compatibilityNodeName = 'platform-k3d-compatibility';

export function readSeedPlatformOptions(args, env) {
  if (args.length !== 0) {
    throw new Error('Usage: node ./scripts/deploy/seed-platform-k3d-e2e.mjs');
  }

  const githubEnvPath = env.GITHUB_ENV;
  if (githubEnvPath === undefined || githubEnvPath.trim() === '') {
    throw new Error('GITHUB_ENV is required to publish the k3d seed contract.');
  }

  return { githubEnvPath };
}

export function parseInstallResult(output, expectedEmail) {
  let result;
  try {
    result = JSON.parse(output);
  } catch {
    throw new Error('Platform seed install did not return JSON.');
  }

  if (
    result === null ||
    typeof result !== 'object' ||
    result.adminEmail !== expectedEmail ||
    result.compartmentUrl !== platformUrl ||
    result.organization?.slug !== seedOrganizationSlug
  ) {
    throw new Error('Platform seed install returned an unexpected result.');
  }

  return result;
}

export function parseCompatibilityNodeResult(output) {
  let result;
  try {
    result = JSON.parse(output);
  } catch {
    throw new Error('Platform compatibility node registration did not return JSON.');
  }

  if (
    result === null ||
    typeof result !== 'object' ||
    result.node?.name !== compatibilityNodeName ||
    typeof result.node?.id !== 'string' ||
    result.node.id === '' ||
    typeof result.registeredAt !== 'string' ||
    result.registeredAt === ''
  ) {
    throw new Error('Platform compatibility node registration returned an unexpected result.');
  }

  return result;
}

export function buildSeedEnvironment(seedAdminEmail, seedAdminPassword) {
  return `COMPARTMENT_E2E_PLATFORM_MODE=k3d
COMPARTMENT_E2E_COMPARTMENT_URL=${platformUrl}
COMPARTMENT_E2E_API_URL=${platformUrl}
COMPARTMENT_E2E_SEED_ADMIN_EMAIL=${seedAdminEmail}
COMPARTMENT_E2E_SEED_ADMIN_PASSWORD=${seedAdminPassword}
COMPARTMENT_E2E_KUBE_CONTEXT=k3d-compartment-e2e
COMPARTMENT_E2E_PLATFORM_NAMESPACE=compartment`;
}

async function main() {
  const options = readSeedPlatformOptions(process.argv.slice(2), process.env);
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const seedAdminEmail = `platform-e2e-${suffix}@compartment.test`;
  const seedAdminPassword = `PlatformE2e-${randomBytes(24).toString('base64url')}!`;
  const envPath = resolve(repositoryRoot, '.env');
  await writeFile(envPath, `COMPARTMENT_API_URL=${platformUrl}\n`, { mode: 0o600 });
  await chmod(envPath, 0o600);

  const installOutput = await installPlatform(seedAdminEmail, seedAdminPassword);
  parseInstallResult(installOutput, seedAdminEmail);
  registerCompatibilityNode();
  await appendFile(options.githubEnvPath, `${buildSeedEnvironment(seedAdminEmail, seedAdminPassword)}\n`, {
    mode: 0o600,
  });
  process.stdout.write(`Seeded ${seedOrganizationSlug} with ${seedAdminEmail}.\n`);
}

async function installPlatform(seedAdminEmail, seedAdminPassword) {
  const response = await fetch(new URL('/v1/install', platformUrl), {
    body: JSON.stringify({
      adminEmail: seedAdminEmail,
      adminPassword: seedAdminPassword,
      baseDomain: platformBaseDomain,
      organizationName: 'Platform E2E',
      organizationSlug: seedOrganizationSlug,
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Platform seed install failed with HTTP ${response.status.toString()}: ${body}`);
  }
  return body;
}

function registerCompatibilityNode() {
  const registration = spawnSync(
    'kubectl',
    [
      '--context',
      'k3d-compartment-e2e',
      '--namespace',
      'compartment',
      'exec',
      'deployment/compartment-compartment-api',
      '--',
      'node',
      '--input-type=module',
      '--eval',
      buildCompatibilityNodeRegistrationScript(),
    ],
    { cwd: repositoryRoot, encoding: 'utf8', env: process.env },
  );
  if (registration.status !== 0) {
    process.stderr.write(registration.stderr);
    throw new Error(
      `Platform compatibility node registration failed with exit code ${registration.status?.toString() ?? 'unknown'}.`,
    );
  }

  parseCompatibilityNodeResult(registration.stdout);
}

function buildCompatibilityNodeRegistrationScript() {
  return `
const port = process.env.COMPARTMENT_API_PORT;
const runtimeControlToken = process.env.COMPARTMENT_RUNTIME_CONTROL_TOKEN;
const nodeSocketPath = process.env.COMPARTMENT_NODE_AGENT_SOCKET;
if (!port || !runtimeControlToken || !nodeSocketPath) throw new Error('API compatibility node environment is incomplete.');
const response = await fetch(\`http://127.0.0.1:\${port}/internal/nodes/register\`, {
  body: JSON.stringify({ nodeName: '${compatibilityNodeName}', nodeSocketPath, nodeVersion: 'kubernetes-compatibility' }),
  headers: { authorization: \`Bearer \${runtimeControlToken}\`, 'content-type': 'application/json' },
  method: 'POST',
});
const body = await response.text();
if (!response.ok) {
  process.stderr.write(body);
  process.exit(1);
}
process.stdout.write(body);
`;
}

runMain(import.meta.url, process.argv[1], main);
