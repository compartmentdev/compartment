import { access, chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execa } from './managed-vm-command.service';
import type {
  ManagedVmDownloadedArtifacts,
  ManagedVmPreparedBaseArtifacts,
  ManagedVmPreparedGvisorArtifacts,
} from './managed-vm-artifacts.service.types';
import type { ManagedVmArtifact, ManagedVmArtifactName } from './managed-vm-provisioning.types';
import { digest } from './managed-vm-state.service';

export type { ManagedVmDownloadedArtifacts } from './managed-vm-artifacts.service.types';

export async function downloadManagedVmArtifacts(
  artifacts: readonly ManagedVmArtifact[],
): Promise<ManagedVmDownloadedArtifacts> {
  const directory: string = await mkdtemp(join(tmpdir(), 'compartment-vm-'));
  try {
    return await downloadAndPrepareArtifacts(directory, artifacts);
  } catch (error) {
    await rm(directory, { force: true, recursive: true });
    throw error;
  }
}

async function downloadAndPrepareArtifacts(
  directory: string,
  artifacts: readonly ManagedVmArtifact[],
): Promise<ManagedVmDownloadedArtifacts> {
  const base: ManagedVmPreparedBaseArtifacts = await prepareBaseArtifacts(directory, artifacts);
  const gvisor: ManagedVmPreparedGvisorArtifacts = await prepareGvisorArtifacts(directory, artifacts);
  return { ...base, ...gvisor, directory };
}

async function prepareBaseArtifacts(
  directory: string,
  artifacts: readonly ManagedVmArtifact[],
): Promise<ManagedVmPreparedBaseArtifacts> {
  const k3sPath: string = await downloadArtifact(directory, findArtifact(artifacts, 'k3s'), 'k3s');
  const k3sInstallScriptPath: string = await downloadArtifact(
    directory,
    findArtifact(artifacts, 'k3s-install-script'),
    'install-k3s.sh',
  );
  const archivePath: string = await downloadArtifact(directory, findArtifact(artifacts, 'helm'), 'helm.tgz');
  const certManagerManifestPath: string = await downloadArtifact(
    directory,
    findArtifact(artifacts, 'cert-manager'),
    'cert-manager.yaml',
  );
  await execa('tar', ['-xzf', archivePath, '-C', directory]);
  const helmPath: string = join(directory, 'linux-amd64', 'helm');
  await Promise.all([chmod(k3sPath, 0o755), chmod(k3sInstallScriptPath, 0o700), chmod(helmPath, 0o755)]);
  return { certManagerManifestPath, helmPath, k3sInstallScriptPath, k3sPath };
}

async function prepareGvisorArtifacts(
  directory: string,
  artifacts: readonly ManagedVmArtifact[],
): Promise<ManagedVmPreparedGvisorArtifacts> {
  const archivePath: string = await downloadArtifact(directory, findArtifact(artifacts, 'gvisor'), 'runsc.deb');
  const gvisorDirectory: string = join(directory, 'gvisor');
  await execa('/usr/bin/dpkg-deb', ['--extract', archivePath, gvisorDirectory]);
  const prepared: ManagedVmPreparedGvisorArtifacts = readPreparedGvisorArtifacts(gvisorDirectory);
  await assertRequiredArtifacts(Object.values(prepared));
  return prepared;
}

function readPreparedGvisorArtifacts(directory: string): ManagedVmPreparedGvisorArtifacts {
  return {
    gvisorCheckpointGoferPath: join(directory, 'usr/bin/gvisor-bin/checkpointgofer'),
    gvisorContainerdShimPath: join(directory, 'usr/bin/containerd-shim-runsc-v1'),
    gvisorMetricServerPath: join(directory, 'usr/bin/gvisor-bin/runsc-metric-server'),
    gvisorRunscConfigPath: join(directory, 'etc/containerd/runsc.toml'),
    gvisorRunscPath: join(directory, 'usr/bin/runsc'),
  };
}

async function assertRequiredArtifacts(paths: readonly string[]): Promise<void> {
  try {
    await Promise.all(paths.map(async (path: string): Promise<void> => await access(path)));
  } catch (error) {
    throw new Error('Managed-VM gVisor package is missing a required runtime file.', { cause: error });
  }
}

export async function cleanManagedVmArtifacts(artifacts: ManagedVmDownloadedArtifacts): Promise<void> {
  await rm(artifacts.directory, { force: true, recursive: true });
}

async function downloadArtifact(directory: string, artifact: ManagedVmArtifact, name: string): Promise<string> {
  const response: Response = await fetch(artifact.url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) {
    throw new Error(`${artifact.name} download failed with HTTP ${String(response.status)}.`);
  }
  const bytes: Buffer = Buffer.from(await response.arrayBuffer());
  if (digest(bytes) !== artifact.sha256) {
    throw new Error(`${artifact.name} digest verification failed.`);
  }
  if (artifact.name === 'gvisor' && digestSha512(bytes) !== artifact.sha512) {
    throw new Error(`${artifact.name} SHA-512 verification failed.`);
  }
  const path: string = join(directory, name);
  await writeFile(path, bytes, { mode: 0o600 });
  return path;
}

function digestSha512(content: Buffer): string {
  return createHash('sha512').update(content).digest('hex');
}

function findArtifact(artifacts: readonly ManagedVmArtifact[], name: ManagedVmArtifactName): ManagedVmArtifact {
  const artifact: ManagedVmArtifact | undefined = artifacts.find(
    (item: ManagedVmArtifact): boolean => item.name === name,
  );
  if (artifact === undefined) {
    throw new Error(`Managed-VM release metadata is missing ${name}.`);
  }
  return artifact;
}
