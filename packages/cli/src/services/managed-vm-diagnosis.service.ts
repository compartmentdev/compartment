import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execa, type ManagedVmCommandResult } from './managed-vm-command.service';
import { inspectManagedVmHost } from './managed-vm-host-runtime.service';
import type { ManagedVmHostInventory, ManagedVmProvisionerState } from './managed-vm-provisioning.types';
import type { ManagedVmDiagnoseResult } from './managed-vm-lifecycle.service.types';
import { readManagedVmState } from './managed-vm-state.service';

export async function createManagedVmDiagnosis(outputPath?: string): Promise<ManagedVmDiagnoseResult> {
  const state: ManagedVmProvisionerState | undefined = await readManagedVmState();
  if (state === undefined) {
    throw new Error('This host is not a Compartment-managed VM installation.');
  }
  const directory: string = await mkdtemp(join(tmpdir(), 'compartment-diagnose-'));
  const bundlePath: string = resolve(outputPath ?? `compartment-diagnose-${state.installationId}.tar.gz`);
  try {
    await writeManagedVmDiagnosis(directory, state);
    await execa('tar', ['-czf', bundlePath, '-C', directory, '.']);
    return { bundlePath };
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

async function writeManagedVmDiagnosis(directory: string, state: ManagedVmProvisionerState): Promise<void> {
  const commands: readonly Promise<string>[] = [
    diagnosticCommand('systemctl', ['status', 'k3s.service', '--no-pager']),
    diagnosticCommand('journalctl', ['--unit', 'k3s.service', '--lines', '500', '--no-pager']),
    diagnosticCommand('k3s', ['kubectl', 'get', 'nodes', '-o', 'wide']),
    diagnosticCommand('k3s', ['kubectl', 'get', 'events', '--all-namespaces']),
    diagnosticCommand('k3s', ['kubectl', '--namespace', 'compartment', 'get', 'pods']),
  ];
  const [systemd, journal, nodes, events, workloads] = await Promise.all(commands);
  const host: ManagedVmHostInventory = await inspectManagedVmHost();
  await Promise.all([
    writeFile(join(directory, 'state.json'), `${JSON.stringify(state, undefined, 2)}\n`, { mode: 0o600 }),
    writeFile(join(directory, 'systemd.txt'), redact(systemd ?? ''), { mode: 0o600 }),
    writeFile(join(directory, 'journal.txt'), redact(journal ?? ''), { mode: 0o600 }),
    writeFile(join(directory, 'nodes.txt'), redact(nodes ?? ''), { mode: 0o600 }),
    writeFile(join(directory, 'events.txt'), redact(events ?? ''), { mode: 0o600 }),
    writeFile(join(directory, 'workloads.txt'), redact(workloads ?? ''), { mode: 0o600 }),
    writeFile(join(directory, 'host.json'), `${JSON.stringify(host, undefined, 2)}\n`, { mode: 0o600 }),
  ]);
}

async function diagnosticCommand(command: string, args: readonly string[]): Promise<string> {
  const result: ManagedVmCommandResult = await execa(command, args, { reject: false });
  return `${result.stdout}\n${result.stderr}`.trim();
}

function redact(value: string): string {
  return value
    .replace(/(token|password|client-key-data|certificate-authority-data)[=:]?\s*\S+/giu, '$1: [REDACTED]')
    .replace(/Bearer\s+\S+/giu, 'Bearer [REDACTED]');
}
