import { readFile } from 'node:fs/promises';
import { execa } from './managed-vm-command.service';
import { waitForManagedVmKubernetes } from './managed-vm-cluster.service';
import { installNewManagedVmFile, replaceManagedVmFile } from './managed-vm-owned-file.service';
import { managedVmReleaseMetadata } from './managed-vm-release-metadata.service';
import { managedVmSandboxRuntimePaths } from './managed-vm-sandbox-runtime.constants';
import {
  renderManagedVmBuildRunscConfig,
  renderManagedVmContainerdTemplate,
} from './managed-vm-sandbox-runtime-config.service';
import { applyManagedVmRuntimeClasses, verifyManagedVmSandboxRuntime } from './managed-vm-sandbox-runtime.service';
import { managedVmFileIdentity, readManagedVmPathIdentity } from './managed-vm-state.service';

export async function upgradeManagedVmBuildSandboxRuntime(): Promise<Readonly<Record<string, string>>> {
  const buildConfigIdentity: string = await ensureBuildRunscConfig();
  const templateIdentity: string = await ensureContainerdTemplate();
  await execa('systemctl', ['restart', 'k3s']);
  await waitForManagedVmKubernetes();
  await applyManagedVmRuntimeClasses();
  await verifyManagedVmSandboxRuntime();
  return {
    [managedVmSandboxRuntimePaths.buildRunscConfig]: buildConfigIdentity,
    [managedVmSandboxRuntimePaths.containerdTemplate]: templateIdentity,
  };
}

async function ensureBuildRunscConfig(): Promise<string> {
  const base: string = String(await readFile(managedVmSandboxRuntimePaths.runscConfig, 'utf8'));
  const content: Buffer = renderManagedVmBuildRunscConfig(base);
  const identity: string = managedVmFileIdentity(content, 0o600);
  const observed: string | undefined = await readManagedVmPathIdentity(
    managedVmSandboxRuntimePaths.buildRunscConfig,
    managedVmReleaseMetadata.metadataVersion,
  );
  if (observed === undefined) {
    await installNewManagedVmFile(managedVmSandboxRuntimePaths.buildRunscConfig, content, 0o600);
  } else if (observed !== identity) {
    throw new Error(
      `Managed-VM provisioning refuses unexpected content at ${managedVmSandboxRuntimePaths.buildRunscConfig}.`,
    );
  }
  return identity;
}

async function ensureContainerdTemplate(): Promise<string> {
  const legacyContent: string = renderManagedVmContainerdTemplate(false);
  const currentContent: string = renderManagedVmContainerdTemplate();
  const legacyIdentity: string = managedVmFileIdentity(legacyContent, 0o600);
  const currentIdentity: string = managedVmFileIdentity(currentContent, 0o600);
  const observed: string | undefined = await readManagedVmPathIdentity(
    managedVmSandboxRuntimePaths.containerdTemplate,
    managedVmReleaseMetadata.metadataVersion,
  );
  if (observed === legacyIdentity) {
    await replaceManagedVmFile(managedVmSandboxRuntimePaths.containerdTemplate, legacyIdentity, currentContent, 0o600);
  } else if (observed !== currentIdentity) {
    throw new Error(
      `Managed-VM provisioning refuses unexpected content at ${managedVmSandboxRuntimePaths.containerdTemplate}.`,
    );
  }
  return currentIdentity;
}
