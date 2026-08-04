import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execa } from './managed-vm-command.service';
import type { ManagedVmDownloadedArtifacts } from './managed-vm-artifacts.service.types';
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
  return { certManagerManifestPath, directory, helmPath, k3sInstallScriptPath, k3sPath };
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
  const path: string = join(directory, name);
  await writeFile(path, bytes, { mode: 0o600 });
  return path;
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
