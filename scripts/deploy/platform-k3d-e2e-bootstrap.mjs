import { randomBytes, randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parse, stringify } from 'yaml';

import { runCommandAsync } from '../lib/command.mjs';
import { readRepositoryRoot } from '../lib/repository-root.mjs';

const repositoryRoot = readRepositoryRoot(import.meta.url, 2);
const chartPath = join(repositoryRoot, 'deploy/chart/compartment');
const releaseName = 'compartment';
const registryClusterIp = '10.43.250.250';
const platformBaseDomain = 'compartment.localhost';
const platformOrganizationName = 'Platform E2E';
const platformOrganizationSlug = 'platform-e2e';
const readinessAttempts = 120;

export async function runPlatformK3dHarnessBootstrap(env, signal) {
  const valuesPath = resolve(repositoryRoot, readRequiredEnv(env, 'COMPARTMENT_E2E_PLATFORM_VALUES_PATH'));
  const ownerEnvironmentPath = resolve(repositoryRoot, readRequiredEnv(env, 'COMPARTMENT_E2E_OWNER_ENV_PATH'));
  const namespace = readRequiredEnv(env, 'COMPARTMENT_E2E_PLATFORM_NAMESPACE');
  const kubeContext = readRequiredEnv(env, 'COMPARTMENT_E2E_KUBE_CONTEXT');
  const apiUrl = readRequiredEnv(env, 'COMPARTMENT_E2E_API_URL');
  const installToken = randomBytes(32).toString('hex');
  const ownerEmail = `platform-e2e-${randomUUID().replaceAll('-', '').slice(0, 12)}@compartment.test`;
  const ownerPassword = `PlatformE2e-${randomBytes(24).toString('base64url')}!`;
  const values = buildPlatformK3dHarnessBootstrapValues(parse(await readFile(valuesPath, 'utf8')), {
    installToken,
    installationId: randomUUID(),
    productLogIngestToken: randomBytes(32).toString('hex'),
  });
  await writeFile(valuesPath, stringify(values), { mode: 0o600 });

  await runCommandAsync(
    'helm',
    [
      'upgrade',
      '--install',
      releaseName,
      chartPath,
      '--kube-context',
      kubeContext,
      '--namespace',
      namespace,
      '--create-namespace',
      '--values',
      valuesPath,
      '--rollback-on-failure',
      '--wait',
      '--wait-for-jobs',
      '--timeout',
      '8m',
    ],
    repositoryRoot,
    env,
    { signal, terminateProcessGroup: true },
  );

  await waitForPlatformApi(apiUrl, signal);
  await createPlatformOwner(apiUrl, installToken, ownerEmail, ownerPassword, signal);
  await publishOwnerEnvironment(ownerEnvironmentPath, ownerEmail, ownerPassword, env);
}

function buildPlatformK3dHarnessBootstrapValues(values, { installToken, installationId, productLogIngestToken }) {
  if (values === null || typeof values !== 'object' || Array.isArray(values)) {
    throw new Error('Expected generated platform values to be an object.');
  }
  return {
    ...values,
    platform: {
      ...(values.platform ?? {}),
      baseDomain: platformBaseDomain,
      domainCommit: true,
      domainGeneration: 1,
      domainMode: 'custom',
      installationId,
      publicProtocol: 'http',
      startupStage: 'full',
      tlsMode: 'issuer',
    },
    registry: {
      ...(values.registry ?? {}),
      hostname: registryClusterIp,
    },
    secrets: {
      ...(values.secrets ?? {}),
      installToken,
      productLogIngestToken,
    },
  };
}

async function waitForPlatformApi(apiUrl, signal) {
  for (let attempt = 1; attempt <= readinessAttempts; attempt += 1) {
    try {
      const response = await fetch(apiUrl, { redirect: 'manual', signal });
      if (response.status >= 200 && response.status < 500) {
        return;
      }
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }
    }
    await delay(1_000, undefined, { signal });
  }
  throw new Error(`Platform API did not become reachable at ${apiUrl}.`);
}

async function createPlatformOwner(apiUrl, installToken, ownerEmail, ownerPassword, signal) {
  const response = await fetch(new URL('/v1/install', apiUrl), {
    body: JSON.stringify({
      adminEmail: ownerEmail,
      adminPassword: ownerPassword,
      baseDomain: platformBaseDomain,
      organizationName: platformOrganizationName,
      organizationSlug: platformOrganizationSlug,
    }),
    headers: {
      authorization: `Bearer ${installToken}`,
      'content-type': 'application/json',
    },
    method: 'POST',
    signal,
  });
  if (!response.ok) {
    throw new Error(`Harness owner bootstrap failed with HTTP ${response.status.toString()}.`);
  }
}

async function publishOwnerEnvironment(path, ownerEmail, ownerPassword, env) {
  const content =
    `COMPARTMENT_E2E_SEED_ADMIN_EMAIL=${ownerEmail}\n` + `COMPARTMENT_E2E_SEED_ADMIN_PASSWORD=${ownerPassword}\n`;
  await mkdir(dirname(path), { mode: 0o700, recursive: true });
  await writeFile(path, content, { mode: 0o600 });
  const githubEnvPath = env.GITHUB_ENV?.trim() ?? '';
  if (githubEnvPath !== '') {
    await appendFile(githubEnvPath, content, { mode: 0o600 });
  }
}

function readRequiredEnv(env, name) {
  const value = env[name]?.trim() ?? '';
  if (value === '') {
    throw new Error(`Expected ${name} to be configured for the platform k3d harness bootstrap.`);
  }
  return value;
}
