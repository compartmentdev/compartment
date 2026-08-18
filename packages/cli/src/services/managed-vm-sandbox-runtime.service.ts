import { lstat, open, readFile, type FileHandle } from 'node:fs/promises';
import { constants, type Stats } from 'node:fs';
import { execa, type ManagedVmCommandResult } from './managed-vm-command.service';
import type { ManagedVmDownloadedArtifacts } from './managed-vm-artifacts.service.types';
import { waitForManagedVmKubernetes } from './managed-vm-cluster.service';
import { managedVmReleaseMetadata } from './managed-vm-release-metadata.service';
import { verifyKubernetesSandboxRuntime } from './kubernetes-sandbox-runtime-preflight.service';
import { managedVmSandboxRuntimePaths } from './managed-vm-sandbox-runtime.constants';
import { assertManagedVmGvisorHelperDirectory } from './managed-vm-gvisor-helper-directory.service';
import { ensureManagedVmDirectory, installNewManagedVmFile } from './managed-vm-owned-file.service';
import {
  managedVmDirectoryIdentity,
  managedVmFileIdentity,
  readManagedVmPathIdentity,
} from './managed-vm-state.service';
import {
  renderManagedVmBuildRunscConfig,
  renderManagedVmContainerdTemplate,
  renderManagedVmRuntimeClasses,
} from './managed-vm-sandbox-runtime-config.service';

const gvisorRuntimeClassName: string = 'gvisor';
const gvisorBuildRuntimeClassName: string = 'gvisor-build';
const expectedRuntimeType: string = 'io.containerd.runsc.v1';

interface ExpectedSandboxRuntimeFile {
  content: Buffer;
  destination: string;
  mode: number;
}

export async function installManagedVmSandboxRuntime(
  artifacts: ManagedVmDownloadedArtifacts,
): Promise<Readonly<Record<string, string>>> {
  const directoryIdentities: Readonly<Record<string, string>> = await prepareSandboxRuntimeDirectories();
  await assertManagedVmGvisorHelperDirectory(false);
  const expectedFiles: readonly ExpectedSandboxRuntimeFile[] = await readExpectedSandboxRuntimeFiles(artifacts);
  await Promise.all(
    expectedFiles.map(async (file: ExpectedSandboxRuntimeFile): Promise<void> => {
      await installNewManagedVmFile(file.destination, file.content, file.mode);
    }),
  );
  await assertManagedVmGvisorHelperDirectory(true);
  await assertExpectedSandboxRuntimeFiles(expectedFiles);
  await execa('systemctl', ['restart', 'k3s']);
  await waitForManagedVmKubernetes();
  await applyManagedVmRuntimeClasses();
  await verifyManagedVmSandboxRuntime();
  await assertExpectedSandboxRuntimeFiles(expectedFiles);
  return { ...expectedSandboxRuntimeOwnedDigests(expectedFiles), ...directoryIdentities };
}

export async function isManagedVmSandboxRuntimeHealthy(): Promise<boolean> {
  try {
    await verifyManagedVmSandboxRuntime();
    return true;
  } catch {
    return false;
  }
}

export async function verifyManagedVmSandboxRuntime(): Promise<void> {
  await verifyManagedVmSandboxRuntimeFiles();
  await verifyKubernetesSandboxRuntime({
    kubeContext: 'default',
    kubeconfigPath: '/etc/rancher/k3s/k3s.yaml',
    runtimeClassName: gvisorRuntimeClassName,
  });
  await verifyKubernetesSandboxRuntime({
    kubeContext: 'default',
    kubeconfigPath: '/etc/rancher/k3s/k3s.yaml',
    runtimeClassName: gvisorBuildRuntimeClassName,
  });
}

async function verifyManagedVmSandboxRuntimeFiles(): Promise<void> {
  await assertManagedVmGvisorHelperDirectory(true);
  const [version, template, runscConfig, buildRunscConfig]: [ManagedVmCommandResult, string, string, string] =
    await Promise.all([
      execa(managedVmSandboxRuntimePaths.runsc, ['--version']),
      readFile(managedVmSandboxRuntimePaths.containerdTemplate, 'utf8'),
      readFile(managedVmSandboxRuntimePaths.runscConfig, 'utf8'),
      readFile(managedVmSandboxRuntimePaths.buildRunscConfig, 'utf8'),
    ]);
  if (!version.stdout.includes(managedVmReleaseMetadata.gvisorVersion)) {
    throw new Error('Managed-VM gVisor version verification failed.');
  }
  if (
    template !== renderManagedVmContainerdTemplate() ||
    !runscConfig.includes('[runsc_config]') ||
    !buildRunscConfig.includes('file-access-mounts = "exclusive"')
  ) {
    throw new Error('Managed-VM runsc containerd configuration verification failed.');
  }
  const containerdConfig: string = await readFile(managedVmSandboxRuntimePaths.containerdConfig, 'utf8');
  if (
    !containerdConfig.includes(expectedRuntimeType) ||
    !containerdConfig.includes(managedVmSandboxRuntimePaths.runscConfig) ||
    !containerdConfig.includes(managedVmSandboxRuntimePaths.buildRunscConfig) ||
    !containerdConfig.includes('pod_annotations = ["dev.gvisor.spec.mount.*"]')
  ) {
    throw new Error('Managed-VM K3s containerd did not register the runsc runtime handler.');
  }
}

async function prepareSandboxRuntimeDirectories(): Promise<Readonly<Record<string, string>>> {
  await assertCanonicalK3sContainerdDirectory();
  await ensureManagedVmDirectory(managedVmSandboxRuntimePaths.containerdDirectory, 0o755);
  const gvisorBinIdentity: string = await ensureManagedVmDirectory(
    managedVmSandboxRuntimePaths.gvisorBinDirectory,
    0o755,
  );
  return { [managedVmSandboxRuntimePaths.gvisorBinDirectory]: gvisorBinIdentity };
}

async function assertCanonicalK3sContainerdDirectory(): Promise<void> {
  const observedIdentity: string | undefined = await readManagedVmPathIdentity(
    managedVmSandboxRuntimePaths.containerdTemplateDirectory,
    managedVmReleaseMetadata.metadataVersion,
  );
  const expectedIdentity: string = managedVmDirectoryIdentity({ gid: 0, mode: 0o755, uid: 0 });
  if (observedIdentity !== expectedIdentity) {
    throw new Error(
      `Managed-VM provisioning refuses an unexpected K3s containerd directory at ${managedVmSandboxRuntimePaths.containerdTemplateDirectory}.`,
    );
  }
}

export async function applyManagedVmRuntimeClasses(): Promise<void> {
  await execa('k3s', ['kubectl', 'apply', '--filename', '-'], { input: renderManagedVmRuntimeClasses() });
}

async function readExpectedSandboxRuntimeFiles(
  artifacts: ManagedVmDownloadedArtifacts,
): Promise<readonly ExpectedSandboxRuntimeFile[]> {
  return await Promise.all([
    expectedFile(artifacts.gvisorRunscPath, managedVmSandboxRuntimePaths.runsc, 0o755),
    expectedFile(artifacts.gvisorContainerdShimPath, managedVmSandboxRuntimePaths.containerdShim, 0o755),
    expectedFile(artifacts.gvisorCheckpointGoferPath, managedVmSandboxRuntimePaths.checkpointGofer, 0o755),
    expectedFile(artifacts.gvisorMetricServerPath, managedVmSandboxRuntimePaths.metricServer, 0o755),
    expectedFile(artifacts.gvisorRunscConfigPath, managedVmSandboxRuntimePaths.runscConfig, 0o600),
    expectedBuildRunscConfigFile(artifacts.gvisorRunscConfigPath),
    Promise.resolve({
      content: Buffer.from(renderManagedVmContainerdTemplate()),
      destination: managedVmSandboxRuntimePaths.containerdTemplate,
      mode: 0o600,
    }),
  ]);
}

async function expectedBuildRunscConfigFile(source: string): Promise<ExpectedSandboxRuntimeFile> {
  const base: string = String(await readFile(source, 'utf8'));
  return {
    content: renderManagedVmBuildRunscConfig(base),
    destination: managedVmSandboxRuntimePaths.buildRunscConfig,
    mode: 0o600,
  };
}

async function expectedFile(source: string, destination: string, mode: number): Promise<ExpectedSandboxRuntimeFile> {
  return { content: await readFile(source), destination, mode };
}

async function assertExpectedSandboxRuntimeFiles(files: readonly ExpectedSandboxRuntimeFile[]): Promise<void> {
  await Promise.all(
    files.map(
      async (file: ExpectedSandboxRuntimeFile): Promise<void> =>
        await assertExpectedFile(file.destination, file.content, file.mode),
    ),
  );
}

async function assertExpectedFile(destination: string, content: Buffer, mode: number): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(destination, constants.O_RDONLY | constants.O_NOFOLLOW);
    const openedStats: Stats = await handle.stat();
    const observed: Buffer = await handle.readFile();
    const pathStats: Stats = await lstat(destination);
    if (
      !openedStats.isFile() ||
      openedStats.dev !== pathStats.dev ||
      openedStats.ino !== pathStats.ino ||
      (openedStats.mode & 0o7777) !== mode ||
      !observed.equals(content)
    ) {
      throw new Error(`Managed-VM provisioning refuses unexpected content at ${destination}.`);
    }
  } finally {
    await handle?.close();
  }
}

function expectedSandboxRuntimeOwnedDigests(
  files: readonly ExpectedSandboxRuntimeFile[],
): Readonly<Record<string, string>> {
  return Object.fromEntries([
    ...files.map((file: ExpectedSandboxRuntimeFile): [string, string] => [
      file.destination,
      managedVmFileIdentity(file.content, file.mode),
    ]),
  ]);
}
