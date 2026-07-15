import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const registryDataContainerPath = '/var/lib/registry';
const registryContainerPort = '5000';
const registryImageRef = 'registry:2';

async function main() {
  const namespace = readRequiredEnvironmentValue('COMPARTMENT_DOCKER_NAMESPACE');
  const host = readRequiredEnvironmentValue('COMPARTMENT_ARTIFACT_REGISTRY_HOST');
  const port = readRequiredEnvironmentValue('COMPARTMENT_ARTIFACT_REGISTRY_PORT');
  const containerName = `${namespace}-artifact-registry`;
  const registryVolumeName = buildRegistryVolumeName(namespace);

  await removeExistingContainer(containerName);
  await execDockerCommand([
    'run',
    '-d',
    '--name',
    containerName,
    '--label',
    `compartment.namespace=${namespace}`,
    '--label',
    'compartment.component=artifact-registry',
    '--restart',
    'always',
    '-p',
    `${host}:${port}:${registryContainerPort}`,
    '-v',
    `${registryVolumeName}:${registryDataContainerPath}`,
    registryImageRef,
  ]);
}

function readRequiredEnvironmentValue(name) {
  const value = process.env[name];
  if (typeof value === 'string' && value !== '') {
    return value;
  }

  throw new Error(`${name} must be set in .env before running pnpm dev.`);
}

function buildRegistryVolumeName(namespace) {
  return `${namespace}-artifact-registry-data`;
}

async function removeExistingContainer(containerName) {
  try {
    await execDockerCommand(['rm', '-f', containerName]);
  } catch (error) {
    const stderr = error instanceof Error && typeof error.stderr === 'string' ? error.stderr : '';
    if (stderr.includes('No such container')) {
      return;
    }

    throw error;
  }
}

async function execDockerCommand(args) {
  await execFile('docker', args, { cwd: process.cwd() });
}

await main();
