import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { selectInstallTarget } from '../src/services/managed-vm-target.service';

const command: Mock = vi.hoisted((): Mock => vi.fn());
vi.mock('../src/services/managed-vm-command.service', (): { execa: Mock } => ({ execa: command }));

const temporaryDirectories: string[] = [];

afterEach(async (): Promise<void> => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(async (path: string): Promise<void> => await rm(path, { force: true, recursive: true })),
  );
});

describe('install target selection', (): void => {
  beforeEach((): void => {
    command.mockResolvedValue({ exitCode: 0, stderr: '', stdout: 'yes\n' });
  });
  it('selects a clean VM without prompting when no kubeconfig is usable', async (): Promise<void> => {
    await expect(
      selectInstallTarget({ interactive: true, kubeconfigPaths: ['/missing'], managedStateExists: false }),
    ).resolves.toBe('vm');
  });

  it('preserves the existing Kubernetes path when kubeconfig exists', async (): Promise<void> => {
    const directory: string = await mkdtemp(join(tmpdir(), 'target-'));
    temporaryDirectories.push(directory);
    const kubeconfigPath: string = join(directory, 'config');
    await writeFile(
      kubeconfigPath,
      `current-context: existing
contexts:
  - name: existing
    context: { cluster: local, user: owner }
clusters:
  - name: local
    cluster: {}
users:
  - name: owner
    user: {}
`,
    );
    await expect(
      selectInstallTarget({ interactive: true, kubeconfigPaths: [kubeconfigPath], managedStateExists: false }),
    ).resolves.toBe('kubernetes');
  });

  it('ignores a kubeconfig without a valid current context', async (): Promise<void> => {
    const directory: string = await mkdtemp(join(tmpdir(), 'target-'));
    temporaryDirectories.push(directory);
    const kubeconfigPath: string = join(directory, 'config');
    await writeFile(kubeconfigPath, 'current-context: missing\ncontexts: []\n');
    await expect(
      selectInstallTarget({ interactive: true, kubeconfigPaths: [kubeconfigPath], managedStateExists: false }),
    ).resolves.toBe('vm');
  });

  it('selects the VM when the configured cluster is not reachable with the required capability', async (): Promise<void> => {
    const directory: string = await mkdtemp(join(tmpdir(), 'target-'));
    temporaryDirectories.push(directory);
    const kubeconfigPath: string = join(directory, 'config');
    await writeFile(
      kubeconfigPath,
      `current-context: existing
contexts: [{ name: existing, context: { cluster: local, user: owner } }]
clusters: [{ name: local, cluster: {} }]
users: [{ name: owner, user: {} }]
`,
    );
    command.mockResolvedValue({ exitCode: 1, stderr: 'unreachable', stdout: '' });
    await expect(
      selectInstallTarget({ interactive: true, kubeconfigPaths: [kubeconfigPath], managedStateExists: false }),
    ).resolves.toBe('vm');
  });

  it('requires the automation target explicitly', async (): Promise<void> => {
    await expect(
      selectInstallTarget({ interactive: false, kubeconfigPaths: [], managedStateExists: false }),
    ).rejects.toThrow('--target vm|kubernetes');
  });
});
