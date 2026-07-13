import { appendFile, chmod, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { readRepositoryRoot } from '../lib/repository-root.mjs';
import { runMain } from '../lib/run-main.mjs';

const repositoryRoot = readRepositoryRoot(import.meta.url, 2);
const platformUrl = 'http://console.localhost:18080';
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

  const cliPath = resolve(repositoryRoot, '.compartment/cli-dist/compartment');
  const install = spawnSync(
    cliPath,
    [
      'install',
      '--dev',
      '--email',
      seedAdminEmail,
      '--organization',
      'Platform E2E',
      '--organization-slug',
      seedOrganizationSlug,
      '--skip-session-persist',
      '--internal-install-result',
      '--output',
      'json',
    ],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: process.env,
      input: `${seedAdminPassword}\n${seedAdminPassword}\n`,
    },
  );
  if (install.status !== 0) {
    process.stderr.write(install.stderr);
    throw new Error(`Platform seed install failed with exit code ${install.status?.toString() ?? 'unknown'}.`);
  }

  parseInstallResult(install.stdout, seedAdminEmail);
  await appendFile(options.githubEnvPath, `${buildSeedEnvironment(seedAdminEmail, seedAdminPassword)}\n`, {
    mode: 0o600,
  });
  process.stdout.write(`Seeded ${seedOrganizationSlug} with ${seedAdminEmail}.\n`);
}

runMain(import.meta.url, process.argv[1], main);
