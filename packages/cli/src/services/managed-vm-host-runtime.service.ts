import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { cpus, hostname, totalmem } from 'node:os';
import { execa, type ManagedVmCommandResult } from './managed-vm-command.service';
import { digest, managedVmOwnedPaths, readManagedVmState } from './managed-vm-state.service';
import { managedVmReleaseMetadata } from './managed-vm-release-metadata.service';
import type {
  ManagedVmDiskAvailability,
  ManagedVmFirewallKind,
  ManagedVmHostInventory,
  ManagedVmHostObservation,
  ManagedVmObservedState,
  ManagedVmOwnedPath,
  ManagedVmPortConflict,
  ManagedVmProvisionerState,
} from './managed-vm-provisioning.types';

const lockPath: string = '/var/lib/compartment/installer/install.lock';

export async function inspectManagedVmHost(): Promise<ManagedVmHostInventory> {
  return await createHostInventory(await readHostObservation());
}

async function readHostObservation(): Promise<ManagedVmHostObservation> {
  const osRelease: Promise<string> = readFile('/etc/os-release', 'utf8');
  const routeCidrs: Promise<readonly string[]> = readRouteCidrs();
  const portsInUse: Promise<readonly ManagedVmPortConflict[]> = readPortConflicts();
  const disk: Promise<ManagedVmDiskAvailability> = readDiskAvailability();
  const clockSynchronized: Promise<boolean> = readClockSynchronization();
  const firewall: Promise<ManagedVmFirewallKind> = classifyFirewall();
  const publicInterface: Promise<string> = readPublicInterface();
  return {
    clockSynchronized: await clockSynchronized,
    disk: await disk,
    firewall: await firewall,
    osRelease: await osRelease,
    portsInUse: await portsInUse,
    publicInterface: await publicInterface,
    routeCidrs: await routeCidrs,
  };
}

async function createHostInventory(observation: ManagedVmHostObservation): Promise<ManagedVmHostInventory> {
  const os: ReadonlyMap<string, string> = parseOsRelease(observation.osRelease);
  return {
    architecture: process.arch === 'x64' ? 'x86_64' : process.arch,
    cgroupV2: await pathExists('/sys/fs/cgroup/cgroup.controllers'),
    clockSynchronized: observation.clockSynchronized,
    cpuCount: cpus().length,
    freeBytes: observation.disk.freeBytes,
    freeInodes: observation.disk.freeInodes,
    firewall: observation.firewall,
    hostname: hostname(),
    memoryBytes: totalmem(),
    osId: os.get('ID') ?? '',
    osVersion: os.get('VERSION_ID') ?? '',
    portsInUse: observation.portsInUse,
    publicInterface: observation.publicInterface,
    routeCidrs: observation.routeCidrs,
    systemd: await pathExists('/run/systemd/system'),
    sudoAvailable: await isSudoAvailable(),
  };
}

async function isSudoAvailable(): Promise<boolean> {
  return (typeof process.getuid === 'function' && process.getuid() === 0) || (await pathExists('/usr/bin/sudo'));
}

export async function inspectManagedVmState(): Promise<ManagedVmObservedState> {
  let provisionerStateExists: boolean = false;
  let ownedConfigMatches: boolean = false;
  try {
    const state: ManagedVmProvisionerState | undefined = await readManagedVmState();
    provisionerStateExists = state !== undefined;
    if (state !== undefined) {
      ownedConfigMatches =
        state.metadataDigest === digest(JSON.stringify(managedVmReleaseMetadata)) &&
        JSON.stringify(state.ownedPaths) === JSON.stringify(managedVmOwnedPaths);
    }
  } catch (error) {
    if (error instanceof Error && isManagedVmStatePermissionError(error)) {
      throw error;
    }
    provisionerStateExists = true;
  }
  return {
    foreignPaths: ownedConfigMatches ? [] : await findForeignPaths(),
    lockOwner: await readLockOwner(),
    ownedConfigMatches,
    provisionerStateExists,
  };
}

function isManagedVmStatePermissionError(error: Error): boolean {
  return error.cause instanceof Error && 'code' in error.cause && error.cause.code === 'EACCES';
}

export async function observePublicIpv4(observationUrl: string): Promise<string> {
  const response: Response = await fetch(observationUrl, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) {
    throw new Error(`Public address observation failed with HTTP ${String(response.status)}.`);
  }
  return (await response.text()).trim();
}

function parseOsRelease(content: string): ReadonlyMap<string, string> {
  const entries: [string, string][] = content.split('\n').flatMap((line: string): [string, string][] => {
    const match: RegExpMatchArray | null = /^([A-Z_]+)=(.*)$/u.exec(line);
    return match === null ? [] : [[match[1] ?? '', (match[2] ?? '').replace(/^['"]|['"]$/gu, '')]];
  });
  return new Map(entries);
}

async function findForeignPaths(): Promise<readonly string[]> {
  const paths: readonly string[] = [
    ...new Set([
      ...managedVmOwnedPaths.map((ownedPath: ManagedVmOwnedPath): string => ownedPath.path),
      '/etc/kubernetes/admin.conf',
      '/etc/cni/net.d',
      '/etc/containerd/config.toml',
      '/var/lib/containerd',
    ]),
  ];
  const found: (string | undefined)[] = await Promise.all(
    paths.map(async (path: string): Promise<string | undefined> => ((await pathExists(path)) ? path : undefined)),
  );
  return found.filter((path: string | undefined): path is string => path !== undefined);
}

async function readLockOwner(): Promise<string | undefined> {
  if (!(await pathExists(lockPath))) {
    return undefined;
  }
  const owner: string = (await readFile(lockPath, 'utf8')).trim();
  const pid: number = Number(owner.split(/\s+/u)[0]);
  if (Number.isSafeInteger(pid) && pid > 0 && !isProcessRunning(pid)) {
    return undefined;
  }
  return owner === '' ? 'unknown process' : owner;
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH');
  }
}

async function readRouteCidrs(): Promise<readonly string[]> {
  const result: ManagedVmCommandResult = await execa('ip', ['-o', 'route', 'show']);
  return result.stdout
    .split('\n')
    .map((line: string): string => line.trim().split(/\s+/u)[0] ?? '')
    .filter(Boolean);
}

async function readPortConflicts(): Promise<readonly ManagedVmPortConflict[]> {
  const result: ManagedVmCommandResult = await execa('ss', ['-H', '-ltnp']);
  return result.stdout.split('\n').flatMap(parsePortConflict);
}

function parsePortConflict(line: string): ManagedVmPortConflict[] {
  const port: RegExpMatchArray | null = /:(80|443)\s+/u.exec(line);
  const owner: RegExpMatchArray | null = /users:\(\("([^"]+)/u.exec(line);
  return port === null ? [] : [{ owner: owner?.[1] ?? 'unknown process', port: Number(port[1]) }];
}

async function readDiskAvailability(): Promise<ManagedVmDiskAvailability> {
  const [bytes, inodes] = await Promise.all([
    execa('df', ['--output=avail', '-B1', '/var/lib']),
    execa('df', ['--output=iavail', '/var/lib']),
  ]);
  return {
    freeBytes: readLastOutputValue(bytes.stdout),
    freeInodes: readLastOutputValue(inodes.stdout),
  };
}

function readLastOutputValue(stdout: string): number {
  const value: string | undefined = stdout
    .split('\n')
    .map((line: string): string => line.trim())
    .filter(Boolean)
    .at(-1);
  const parsed: number = Number(value ?? '0');
  return Number.isFinite(parsed) ? parsed : 0;
}

async function readClockSynchronization(): Promise<boolean> {
  const result: ManagedVmCommandResult = await execa('timedatectl', ['show', '--property=NTPSynchronized', '--value'], {
    reject: false,
  });
  return result.exitCode === 0 && result.stdout.trim() === 'yes';
}

async function classifyFirewall(): Promise<ManagedVmFirewallKind> {
  if ((await execa('systemctl', ['is-active', 'firewalld'], { reject: false })).exitCode === 0) {
    return 'firewalld';
  }
  if ((await execa('systemctl', ['is-active', 'ufw'], { reject: false })).exitCode === 0) {
    return 'ufw';
  }
  return (await pathExists('/usr/sbin/nft')) ? 'nftables' : 'none';
}

async function readPublicInterface(): Promise<string> {
  const result: ManagedVmCommandResult = await execa('ip', ['-o', 'route', 'show', 'default']);
  const match: RegExpMatchArray | null = /\bdev\s+(\S+)/u.exec(result.stdout);
  return match?.[1] ?? '';
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
