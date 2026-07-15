import { appendFile, chmod, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { readRepositoryRoot } from '../lib/repository-root.mjs';
import { runMain } from '../lib/run-main.mjs';

const repositoryRoot = readRepositoryRoot(import.meta.url, 2);
const platformUrl = 'http://console.compartment.localhost:18080';
const platformBaseDomain = 'compartment.localhost';
const seedOrganizationSlug = 'platform-e2e';

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

runMain(import.meta.url, process.argv[1], main);
