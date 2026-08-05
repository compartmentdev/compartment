import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  unlink,
  writeFile,
  type FileHandle,
} from 'node:fs/promises';
import { constants, type Dirent, type Stats } from 'node:fs';
import { execa, type ManagedVmCommandResult } from './managed-vm-command.service';
import type { ManagedVmDownloadedArtifacts } from './managed-vm-artifacts.service.types';
import { waitForManagedVmKubernetes } from './managed-vm-cluster.service';
import { managedVmReleaseMetadata } from './managed-vm-release-metadata.service';
import { verifyKubernetesSandboxRuntime } from './kubernetes-sandbox-runtime-preflight.service';
import {
  managedVmSandboxRuntimeHelperNames,
  managedVmSandboxRuntimePaths,
} from './managed-vm-sandbox-runtime.constants';
import { managedVmFileIdentity } from './managed-vm-state.service';

const gvisorRuntimeClassName: string = 'gvisor';
const expectedRuntimeType: string = 'io.containerd.runsc.v1';

interface ExpectedSandboxRuntimeFile {
  content: Buffer;
  destination: string;
  mode: number;
}

export async function installManagedVmSandboxRuntime(
  artifacts: ManagedVmDownloadedArtifacts,
): Promise<Readonly<Record<string, string>>> {
  await prepareSandboxRuntimeDirectories();
  await assertGvisorHelperDirectory(false);
  const expectedFiles: readonly ExpectedSandboxRuntimeFile[] = await readExpectedSandboxRuntimeFiles(artifacts);
  await Promise.all(
    expectedFiles.map(
      async (file: ExpectedSandboxRuntimeFile): Promise<void> =>
        await installExpectedContent(file.content, file.destination, file.mode),
    ),
  );
  await assertGvisorHelperDirectory(true);
  await assertExpectedSandboxRuntimeFiles(expectedFiles);
  await execa('systemctl', ['restart', 'k3s']);
  await waitForManagedVmKubernetes();
  await applyManagedVmRuntimeClass();
  await verifyManagedVmSandboxRuntime();
  await assertExpectedSandboxRuntimeFiles(expectedFiles);
  return expectedSandboxRuntimeOwnedDigests(expectedFiles);
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
}

async function verifyManagedVmSandboxRuntimeFiles(): Promise<void> {
  await assertGvisorHelperDirectory(true);
  const [version, template, runscConfig]: [ManagedVmCommandResult, string, string] = await Promise.all([
    execa(managedVmSandboxRuntimePaths.runsc, ['--version']),
    readFile(managedVmSandboxRuntimePaths.containerdTemplate, 'utf8'),
    readFile(managedVmSandboxRuntimePaths.runscConfig, 'utf8'),
  ]);
  if (!version.stdout.includes(managedVmReleaseMetadata.gvisorVersion)) {
    throw new Error('Managed-VM gVisor version verification failed.');
  }
  if (template !== renderContainerdTemplate() || !runscConfig.includes('[runsc_config]')) {
    throw new Error('Managed-VM runsc containerd configuration verification failed.');
  }
  const containerdConfig: string = await readFile('/var/lib/rancher/k3s/agent/etc/containerd/config.toml', 'utf8');
  if (
    !containerdConfig.includes(expectedRuntimeType) ||
    !containerdConfig.includes(managedVmSandboxRuntimePaths.runscConfig) ||
    !containerdConfig.includes('pod_annotations = ["dev.gvisor.spec.mount.*"]')
  ) {
    throw new Error('Managed-VM K3s containerd did not register the runsc runtime handler.');
  }
}

async function prepareSandboxRuntimeDirectories(): Promise<void> {
  await Promise.all([
    mkdir(managedVmSandboxRuntimePaths.containerdDirectory, { mode: 0o755, recursive: true }),
    mkdir(managedVmSandboxRuntimePaths.gvisorBinDirectory, { mode: 0o755, recursive: true }),
    mkdir(managedVmSandboxRuntimePaths.containerdTemplateDirectory, { mode: 0o700, recursive: true }),
  ]);
}

async function applyManagedVmRuntimeClass(): Promise<void> {
  await execa('k3s', ['kubectl', 'apply', '--filename', '-'], { input: renderRuntimeClass() });
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
    Promise.resolve({
      content: Buffer.from(renderContainerdTemplate()),
      destination: managedVmSandboxRuntimePaths.containerdTemplate,
      mode: 0o600,
    }),
  ]);
}

function renderContainerdTemplate(): string {
  return `{{ template "base" . }}

[plugins.'io.containerd.cri.v1.runtime'.containerd.runtimes.runsc]
  runtime_type = "${expectedRuntimeType}"
  pod_annotations = ["dev.gvisor.spec.mount.*"]

[plugins.'io.containerd.cri.v1.runtime'.containerd.runtimes.runsc.options]
  TypeUrl = "io.containerd.runsc.v1.options"
  ConfigPath = "${managedVmSandboxRuntimePaths.runscConfig}"
`;
}

async function expectedFile(source: string, destination: string, mode: number): Promise<ExpectedSandboxRuntimeFile> {
  return { content: await readFile(source), destination, mode };
}

async function installExpectedContent(content: Buffer, destination: string, mode: number): Promise<void> {
  const temporaryPath: string = `${destination}.compartment-installing`;
  if (await assertExpectedFileOrMissing(destination, content, mode)) {
    await removeExpectedTemporaryFile(temporaryPath, content, mode);
    return;
  }
  await prepareExpectedTemporaryFile(temporaryPath, content, mode);
  try {
    await link(temporaryPath, destination);
  } catch (error) {
    if (!(error instanceof Error && isAlreadyExists(error))) {
      throw error;
    }
    await assertExpectedFile(destination, content, mode);
  } finally {
    await removeExpectedTemporaryFile(temporaryPath, content, mode);
  }
}

async function prepareExpectedTemporaryFile(temporaryPath: string, content: Buffer, mode: number): Promise<void> {
  if (await assertExpectedFileOrMissing(temporaryPath, content, mode)) {
    return;
  }
  await writeFile(temporaryPath, content, { flag: 'wx', mode });
  await chmod(temporaryPath, mode);
}

async function assertExpectedFileOrMissing(destination: string, content: Buffer, mode: number): Promise<boolean> {
  try {
    await assertExpectedFile(destination, content, mode);
    return true;
  } catch (error) {
    if (error instanceof Error && isMissing(error)) {
      return false;
    }
    throw error;
  }
}

async function removeExpectedTemporaryFile(temporaryPath: string, content: Buffer, mode: number): Promise<void> {
  try {
    await assertExpectedFile(temporaryPath, content, mode);
    await unlink(temporaryPath);
  } catch (error) {
    if (!(error instanceof Error && isMissing(error))) {
      throw error;
    }
  }
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
    [managedVmSandboxRuntimePaths.gvisorBinDirectory, 'directory'],
  ]);
}

async function assertGvisorHelperDirectory(requireComplete: boolean): Promise<void> {
  const entries: Dirent[] = await readdir(managedVmSandboxRuntimePaths.gvisorBinDirectory, { withFileTypes: true });
  const allowedNames: readonly string[] = [
    ...managedVmSandboxRuntimeHelperNames,
    ...managedVmSandboxRuntimeHelperNames.map((name: string): string => `${name}.compartment-installing`),
  ];
  const observedNames: string[] = entries
    .map((entry: Dirent): string => entry.name)
    .sort((left: string, right: string): number => left.localeCompare(right));
  if (
    entries.some((entry: Dirent): boolean => !entry.isFile() || !allowedNames.includes(entry.name)) ||
    (requireComplete && JSON.stringify(observedNames) !== JSON.stringify(managedVmSandboxRuntimeHelperNames))
  ) {
    throw new Error('Managed-VM provisioning found unexpected content in the gVisor helper directory.');
  }
}

function isMissing(error: Error): boolean {
  return 'code' in error && error.code === 'ENOENT';
}

function isAlreadyExists(error: Error): boolean {
  return 'code' in error && error.code === 'EEXIST';
}

function renderRuntimeClass(): string {
  return `apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: ${gvisorRuntimeClassName}
handler: runsc
`;
}
