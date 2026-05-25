import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants, readFileSync, type Stats } from 'node:fs';
import { chown, chmod, lstat, mkdir, open, readFile, rename, rm, type FileHandle } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { hasText, isMissingFileSystemEntryError } from '@compartment/utils';
import type { CliConfig } from './config.types';

interface ConfigFileTarget {
  owner?: FileOwner | undefined;
  ownerDirectories?: string[] | undefined;
  path: string;
  requiresOwner?: boolean | undefined;
}

interface FileOwner {
  gid: number;
  uid: number;
}

export async function readCliConfig(): Promise<CliConfig> {
  const configPath: string = getConfigTarget(process.env).path;
  try {
    return await readStoredConfig(configPath);
  } catch (error) {
    const configError: Error = error instanceof Error ? error : new Error('Failed to read CLI config.');
    if (isMissingConfigFile(configError)) {
      return {};
    }

    throw configError;
  }
}

export async function writeCliConfig(config: CliConfig): Promise<void> {
  const configTarget: ConfigFileTarget = getConfigTarget(process.env);
  assertWritableConfigTarget(configTarget);
  await mkdir(dirname(configTarget.path), { mode: 0o700, recursive: true });
  await assertWritableConfigPath(configTarget.path);
  await assertRealConfigDirectories(configTarget);
  await applyConfigTargetDirectoryOwner(configTarget);
  await writeCliConfigAtomically(configTarget, `${JSON.stringify(config, null, 2)}\n`);
}

export async function clearCliConfig(): Promise<void> {
  const configPath: string = getConfigTarget(process.env).path;
  await rm(configPath, { force: true });
}

async function readStoredConfig(configPath: string): Promise<CliConfig> {
  const raw: string = await readFile(configPath, 'utf8');

  return JSON.parse(raw) as CliConfig;
}

function isMissingConfigFile(error: NodeJS.ErrnoException | Error): boolean {
  return error instanceof Error && isMissingFileSystemEntryError(error);
}

function getConfigTarget(env: NodeJS.ProcessEnv): ConfigFileTarget {
  const configDirectoryTarget: ConfigFileTarget = getConfigDirectoryTarget(env);
  return {
    ...configDirectoryTarget,
    path: join(configDirectoryTarget.path, 'config.json'),
  };
}

function getConfigDirectoryTarget(env: NodeJS.ProcessEnv): ConfigFileTarget {
  if (hasText(env.COMPARTMENT_CLI_CONFIG_DIR)) {
    return { path: env.COMPARTMENT_CLI_CONFIG_DIR };
  }
  const sudoUserName: string | undefined = readSudoUserName(env);
  if (sudoUserName !== undefined) {
    const sudoConfigDirectoryTarget: ConfigFileTarget = readSudoConfigDirectoryTarget(env, sudoUserName);
    return {
      ...sudoConfigDirectoryTarget,
      owner: readConfigFileOwner(env, 'SUDO_UID', 'SUDO_GID'),
      requiresOwner: true,
    };
  }
  if (hasText(env.XDG_CONFIG_HOME)) {
    return { path: join(env.XDG_CONFIG_HOME, 'compartment-cli') };
  }

  return { path: join(homedir(), '.config', 'compartment-cli') };
}

function readSudoUserName(env: NodeJS.ProcessEnv): string | undefined {
  if (!hasText(env.SUDO_USER) || env.SUDO_USER === 'root') {
    return undefined;
  }

  return env.SUDO_USER;
}

function readSudoConfigDirectoryTarget(env: NodeJS.ProcessEnv, sudoUserName: string): ConfigFileTarget {
  if (hasText(env.XDG_CONFIG_HOME)) {
    const configDirectory: string = join(env.XDG_CONFIG_HOME, 'compartment-cli');
    return {
      ownerDirectories: [configDirectory],
      path: configDirectory,
    };
  }

  const userConfigRoot: string = join(readSudoUserHome(sudoUserName), '.config');
  const configDirectory: string = join(userConfigRoot, 'compartment-cli');
  return {
    ownerDirectories: [userConfigRoot, configDirectory],
    path: configDirectory,
  };
}

function readSudoUserHome(sudoUserName: string): string {
  return readUserHomeFromAccountDatabase(sudoUserName) ?? readConventionalUserHome(sudoUserName);
}

function readUserHomeFromAccountDatabase(userName: string): string | undefined {
  return readGetentUserHome(userName) ?? readDarwinUserHome(userName) ?? readPasswdUserHome(userName);
}

function readGetentUserHome(userName: string): string | undefined {
  try {
    return readPasswdLineHome(execFileSync('getent', ['passwd', userName], { encoding: 'utf8' }));
  } catch {
    return undefined;
  }
}

function readDarwinUserHome(userName: string): string | undefined {
  if (process.platform !== 'darwin') {
    return undefined;
  }

  try {
    const dsclOutput: string = execFileSync('dscl', ['.', '-read', `/Users/${userName}`, 'NFSHomeDirectory'], {
      encoding: 'utf8',
    });
    const prefix: string = 'NFSHomeDirectory: ';
    return dsclOutput.startsWith(prefix) ? dsclOutput.slice(prefix.length).trim() : undefined;
  } catch {
    return undefined;
  }
}

function readPasswdUserHome(userName: string): string | undefined {
  try {
    for (const line of readFileSync('/etc/passwd', 'utf8').split('\n')) {
      const [name, , , , , home] = line.split(':');
      if (name === userName && hasText(home)) {
        return home;
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function readPasswdLineHome(line: string): string | undefined {
  const [, , , , , home] = line.trim().split(':');
  return hasText(home) ? home : undefined;
}

function readConventionalUserHome(userName: string): string {
  return process.platform === 'darwin' ? join('/Users', userName) : join('/home', userName);
}

function readConfigFileOwner(env: NodeJS.ProcessEnv, uidEnvName: string, gidEnvName: string): FileOwner | undefined {
  const rawUid: string | undefined = env[uidEnvName];
  const rawGid: string | undefined = env[gidEnvName];
  if (!hasText(rawUid) || !hasText(rawGid)) {
    return undefined;
  }

  const uid: number = Number(rawUid);
  const gid: number = Number(rawGid);
  if (!Number.isInteger(uid) || !Number.isInteger(gid) || uid < 0 || gid < 0) {
    return undefined;
  }

  return {
    gid,
    uid,
  };
}

function assertWritableConfigTarget(configTarget: ConfigFileTarget): void {
  if (configTarget.requiresOwner === true && configTarget.owner === undefined) {
    throw new Error('Cannot write CLI config for target user because owner uid and gid are missing or invalid.');
  }
}

async function applyConfigTargetDirectoryOwner(configTarget: ConfigFileTarget): Promise<void> {
  if (configTarget.owner === undefined) {
    return;
  }

  for (const directoryPath of configTarget.ownerDirectories ?? [dirname(configTarget.path)]) {
    await chown(directoryPath, configTarget.owner.uid, configTarget.owner.gid);
  }
}

async function assertWritableConfigPath(configPath: string): Promise<void> {
  try {
    const stats: Stats = await lstat(configPath);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error(`Refusing to write CLI config through non-regular file path ${configPath}.`);
    }
  } catch (error) {
    if (error instanceof Error && isMissingFileSystemEntryError(error)) {
      return;
    }

    throw error;
  }
}

async function assertRealConfigDirectories(configTarget: ConfigFileTarget): Promise<void> {
  const directories: string[] = [...(configTarget.ownerDirectories ?? []), dirname(configTarget.path)];
  for (const directoryPath of [...new Set(directories)]) {
    const stats: Stats = await lstat(directoryPath);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error(`Refusing to write CLI config through non-directory path ${directoryPath}.`);
    }
  }
}

async function writeCliConfigAtomically(configTarget: ConfigFileTarget, contents: string): Promise<void> {
  const tempPath: string = `${configTarget.path}.tmp-${process.pid.toString()}-${randomUUID()}`;
  let handle: FileHandle | null = null;

  try {
    handle = await openCliConfigTempFile(tempPath);
    await writeCliConfigTempFile(handle, contents);
    handle = null;
    await applyCliConfigTempMetadata(tempPath, configTarget.owner);
    await rename(tempPath, configTarget.path);
  } catch (error) {
    await closeCliConfigHandle(handle);
    await rm(tempPath, { force: true });
    throw error;
  }
}

async function openCliConfigTempFile(tempPath: string): Promise<FileHandle> {
  return await open(tempPath, constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_WRONLY, 0o600);
}

async function writeCliConfigTempFile(handle: FileHandle, contents: string): Promise<void> {
  await handle.writeFile(contents, 'utf8');
  await handle.sync();
  await handle.close();
}

async function applyCliConfigTempMetadata(tempPath: string, owner: FileOwner | undefined): Promise<void> {
  await chmod(tempPath, 0o600);
  if (owner !== undefined) {
    await chown(tempPath, owner.uid, owner.gid);
  }
}

async function closeCliConfigHandle(handle: FileHandle | null): Promise<void> {
  if (handle !== null) {
    await handle.close();
  }
}
