import type { Dirent, Stats } from 'node:fs';
import { chmod, chown, mkdir, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { readRequiredAbsolutePath } from '@compartment/utils';
import {
  assertNoExistingSelfHostedDirectorySymlinks,
  assertRealSelfHostedDirectory,
} from './self-hosted-host-directories';
import { readRequiredSelfHostedEnvironmentValue } from './self-hosted-env-file';
import { readOptionalSelfHostedPathStats } from './self-hosted-path-stats';
import {
  ensureSelfHostedRuntimeGroup,
  readSelfHostedRuntimeIdentity,
  type SelfHostedRuntimeIdentity,
} from './self-hosted-runtime-identity';

const privateDirectoryMode: number = 0o700;
const nodeSocketDirectoryMode: number = 0o750;
const privateFileMode: number = 0o600;
const sharedRuntimeDirectoryMode: number = 0o750;
const sharedRuntimeFileMode: number = 0o640;
const managedDirectoryRoots: readonly string[] = [
  '/etc/compartment',
  '/var/run/compartment',
  '/var/lib/compartment',
].map((path: string): string => resolve(path));
const runtimeWritableTreeDirectoryVariables: readonly string[] = [
  'COMPARTMENT_SOURCE_ARCHIVE_DIR',
  'COMPARTMENT_RESOURCE_BACKUP_DIR',
  'COMPARTMENT_AUDIT_FILE_SINK_DIR',
];

interface EnsureSelfHostedRuntimeDirectoriesInput {
  readonly environmentValues: Record<string, string>;
  readonly repairRuntimeWritableDirectoryContents: boolean;
}

interface RuntimeDirectoryOwner {
  readonly gid: number;
  readonly uid: number;
}

interface RuntimeDirectorySpec {
  readonly fileMode?: number | undefined;
  readonly label: string;
  readonly mode: number;
  readonly owner: RuntimeDirectoryOwner;
  readonly path: string;
  readonly repairTree?: boolean;
}

interface RuntimeFileRepairInput {
  readonly directoryMode: number;
  readonly fileMode: number;
  readonly owner: RuntimeDirectoryOwner;
  readonly pendingDirectories: string[];
  readonly path: string;
}

interface RuntimeDirectoryContentsRepairInput {
  readonly directoryMode: number;
  readonly fileMode: number;
  readonly owner: RuntimeDirectoryOwner;
  readonly pendingDirectories: string[];
  readonly path: string;
}

export async function ensureSelfHostedRuntimeDirectories(
  input: EnsureSelfHostedRuntimeDirectoriesInput,
): Promise<void> {
  const identity: SelfHostedRuntimeIdentity = readSelfHostedRuntimeIdentity(input.environmentValues);
  await ensureSelfHostedRuntimeGroup(identity);

  for (const spec of buildRuntimeDirectorySpecs(
    input.environmentValues,
    identity,
    input.repairRuntimeWritableDirectoryContents,
  )) {
    await ensureRuntimeDirectory(spec);
  }
}

function buildRuntimeDirectorySpecs(
  environmentValues: Record<string, string>,
  identity: SelfHostedRuntimeIdentity,
  repairRuntimeWritableDirectoryContents: boolean,
): RuntimeDirectorySpec[] {
  const runtimeOwner: RuntimeDirectoryOwner = { uid: identity.uid, gid: identity.gid };

  return [
    ...buildRootOwnedRuntimeDirectorySpecs(),
    ...buildRuntimeSocketDirectorySpecs(identity),
    ...readRuntimeOwnedDirectorySpecs(environmentValues, runtimeOwner, repairRuntimeWritableDirectoryContents),
    readCustomTlsDirectorySpec(environmentValues, identity),
  ];
}

function buildRootOwnedRuntimeDirectorySpecs(): RuntimeDirectorySpec[] {
  const rootOwner: RuntimeDirectoryOwner = { uid: 0, gid: 0 };

  return [
    {
      label: 'Compartment runtime directory',
      mode: privateDirectoryMode,
      owner: rootOwner,
      path: '/var/run/compartment',
    },
    {
      label: 'Compartment self-hosted state directory',
      mode: privateDirectoryMode,
      owner: rootOwner,
      path: '/var/lib/compartment/self-hosted',
    },
  ];
}

function buildRuntimeSocketDirectorySpecs(identity: SelfHostedRuntimeIdentity): RuntimeDirectorySpec[] {
  const runtimeOwner: RuntimeDirectoryOwner = { uid: identity.uid, gid: identity.gid };

  return [
    {
      label: 'Compartment API socket directory',
      mode: privateDirectoryMode,
      owner: runtimeOwner,
      path: '/var/run/compartment/api',
    },
    {
      label: 'Compartment node agent socket directory',
      mode: nodeSocketDirectoryMode,
      owner: { uid: 0, gid: identity.gid },
      path: '/var/run/compartment/node',
    },
  ];
}

function readRuntimeOwnedDirectorySpecs(
  environmentValues: Record<string, string>,
  owner: RuntimeDirectoryOwner,
  repairRuntimeWritableDirectoryContents: boolean,
): RuntimeDirectorySpec[] {
  return [
    buildRuntimeOwnedDirectorySpec(
      environmentValues,
      owner,
      'COMPARTMENT_DOCKER_WORK_DIR',
      repairRuntimeWritableDirectoryContents,
    ),
    ...runtimeWritableTreeDirectoryVariables.map(
      (variableName: string): RuntimeDirectorySpec =>
        buildRuntimeOwnedDirectorySpec(environmentValues, owner, variableName, repairRuntimeWritableDirectoryContents),
    ),
  ];
}

function readCustomTlsDirectorySpec(
  environmentValues: Record<string, string>,
  identity: SelfHostedRuntimeIdentity,
): RuntimeDirectorySpec {
  const path: string = readRequiredAbsolutePath(
    readRequiredSelfHostedEnvironmentValue(environmentValues, 'COMPARTMENT_CUSTOM_TLS_DIR'),
    'COMPARTMENT_CUSTOM_TLS_DIR',
  );

  return {
    fileMode: sharedRuntimeFileMode,
    label: 'Compartment runtime directory COMPARTMENT_CUSTOM_TLS_DIR',
    mode: sharedRuntimeDirectoryMode,
    owner: { uid: 0, gid: identity.gid },
    path,
    repairTree: true,
  };
}

function buildRuntimeOwnedDirectorySpec(
  environmentValues: Record<string, string>,
  owner: RuntimeDirectoryOwner,
  variableName: string,
  repairTree: boolean,
): RuntimeDirectorySpec {
  const path: string = readRequiredAbsolutePath(
    readRequiredSelfHostedEnvironmentValue(environmentValues, variableName),
    variableName,
  );

  return {
    label: `Compartment runtime directory ${variableName}`,
    mode: privateDirectoryMode,
    owner,
    path,
    repairTree,
  };
}

async function ensureRuntimeDirectory(spec: RuntimeDirectorySpec): Promise<void> {
  await assertNoExistingSelfHostedDirectorySymlinks({
    directoryPath: spec.path,
    label: spec.label,
    managedRoots: managedDirectoryRoots,
  });
  await mkdir(spec.path, { mode: spec.mode, recursive: true });
  await assertRealSelfHostedDirectory(spec.path, spec.label);
  await applyOwnershipIfRoot(spec.path, spec.owner);
  await chmod(spec.path, spec.mode);
  if (spec.repairTree === true) {
    await repairRuntimeDirectoryTree(spec.path, spec.owner, spec.mode, spec.fileMode ?? privateFileMode);
  }
}

async function repairRuntimeDirectoryTree(
  directoryPath: string,
  owner: RuntimeDirectoryOwner,
  directoryMode: number,
  fileMode: number,
): Promise<void> {
  const pendingDirectories: string[] = [directoryPath];
  while (pendingDirectories.length > 0) {
    const currentDirectory: string | undefined = pendingDirectories.pop();
    if (currentDirectory === undefined) {
      return;
    }
    await repairRuntimeDirectoryContents({
      owner,
      path: currentDirectory,
      pendingDirectories,
      directoryMode,
      fileMode,
    });
  }
}

async function repairRuntimeDirectoryContents(input: RuntimeDirectoryContentsRepairInput): Promise<void> {
  const entries: Dirent[] = await readdir(input.path, { withFileTypes: true });
  for (const entry of entries) {
    await repairRuntimeDirectoryEntry({
      owner: input.owner,
      path: join(input.path, entry.name),
      pendingDirectories: input.pendingDirectories,
      directoryMode: input.directoryMode,
      fileMode: input.fileMode,
    });
  }
}

async function repairRuntimeDirectoryEntry(input: RuntimeFileRepairInput): Promise<void> {
  const stats: Stats | null = await readOptionalSelfHostedPathStats(input.path);
  if (stats === null) {
    return;
  }
  assertRealRuntimeDirectoryTreeEntry(input.path, stats);
  await applyOwnershipIfRoot(input.path, input.owner);
  if (stats.isDirectory()) {
    await chmod(input.path, input.directoryMode);
    input.pendingDirectories.push(input.path);
    return;
  }

  await chmod(input.path, input.fileMode);
}

function assertRealRuntimeDirectoryTreeEntry(path: string, stats: Stats): void {
  if (stats.isSymbolicLink() || (!stats.isDirectory() && !stats.isFile())) {
    throw new Error(`Compartment runtime path ${path} must be a real file or directory.`);
  }
}

async function applyOwnershipIfRoot(path: string, owner: RuntimeDirectoryOwner): Promise<void> {
  if (process.getuid?.() !== 0) {
    return;
  }

  await chown(path, owner.uid, owner.gid);
}
