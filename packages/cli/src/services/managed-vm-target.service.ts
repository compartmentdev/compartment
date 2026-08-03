import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { execa, type ManagedVmCommandResult } from './managed-vm-command.service';
import type { InstallTarget, InstallTargetSelectionInput } from './managed-vm-target.service.types';

export type { InstallTarget } from './managed-vm-target.service.types';

interface KubeconfigNamedEntry<TValue> {
  context?: TValue | undefined;
  name?: string | undefined;
}

interface KubeconfigContext {
  cluster?: string | undefined;
  user?: string | undefined;
}

interface KubeconfigDocument {
  clusters?: readonly KubeconfigNamedEntry<never>[] | undefined;
  contexts?: readonly KubeconfigNamedEntry<KubeconfigContext>[] | undefined;
  'current-context'?: string | undefined;
  users?: readonly KubeconfigNamedEntry<never>[] | undefined;
}

export async function selectInstallTarget(input: InstallTargetSelectionInput): Promise<InstallTarget> {
  if (input.explicitTarget !== undefined) {
    return input.explicitTarget;
  }
  if (!input.interactive) {
    throw new Error('--target vm|kubernetes is required without an interactive terminal.');
  }
  if (input.managedStateExists) {
    return 'vm';
  }
  return (await hasUsableKubeconfig(input.kubeconfigPaths)) ? 'kubernetes' : 'vm';
}

async function hasUsableKubeconfig(paths: readonly string[]): Promise<boolean> {
  const results: boolean[] = await Promise.all(paths.map(hasValidCurrentContext));
  return results.includes(true);
}

async function hasValidCurrentContext(path: string): Promise<boolean> {
  try {
    const document: KubeconfigDocument = parse(await readFile(path, 'utf8')) as KubeconfigDocument;
    const currentContextName: string | undefined = document['current-context'];
    if (!hasValidContextReferences(document, currentContextName)) {
      return false;
    }
    const reachable: ManagedVmCommandResult = await execa(
      'kubectl',
      ['--kubeconfig', path, '--request-timeout=5s', 'auth', 'can-i', 'get', 'namespaces'],
      { reject: false },
    );
    return reachable.exitCode === 0 && reachable.stdout.trim() === 'yes';
  } catch {
    return false;
  }
}

function hasValidContextReferences(document: KubeconfigDocument, currentContextName: string | undefined): boolean {
  const currentContext: KubeconfigContext | undefined = document.contexts?.find(
    (entry: KubeconfigNamedEntry<KubeconfigContext>): boolean => entry.name === currentContextName,
  )?.context;
  return (
    currentContextName !== undefined &&
    currentContext !== undefined &&
    document.clusters?.some((entry: KubeconfigNamedEntry<never>): boolean => entry.name === currentContext.cluster) ===
      true &&
    document.users?.some((entry: KubeconfigNamedEntry<never>): boolean => entry.name === currentContext.user) === true
  );
}
