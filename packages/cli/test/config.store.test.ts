import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { clearCliConfig, readCliConfig, writeCliConfig } from '../src/store/config.store';
import type { CliConfig } from '../src/store/config.types';
import { createCliConfigFixture, createCliOrganizationFixture } from './cli-test.fixtures';

interface ConfigStoreTestEnv {
  HOME?: string | undefined;
  COMPARTMENT_CLI_CONFIG_DIR?: string | undefined;
  SUDO_GID?: string | undefined;
  SUDO_UID?: string | undefined;
  SUDO_USER?: string | undefined;
  XDG_CONFIG_HOME?: string | undefined;
}

const originalEnv: ConfigStoreTestEnv = {
  HOME: process.env.HOME,
  COMPARTMENT_CLI_CONFIG_DIR: process.env.COMPARTMENT_CLI_CONFIG_DIR,
  SUDO_GID: process.env.SUDO_GID,
  SUDO_UID: process.env.SUDO_UID,
  SUDO_USER: process.env.SUDO_USER,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
};

const createdDirectories: string[] = [];

async function createTempDirectory(prefix: string): Promise<string> {
  const directory: string = await mkdtemp(join(tmpdir(), prefix));
  createdDirectories.push(directory);
  return directory;
}

function readCurrentFileOwnerEnv(): Pick<ConfigStoreTestEnv, 'SUDO_GID' | 'SUDO_UID'> {
  const uid: number | undefined = process.getuid?.();
  const gid: number | undefined = process.getgid?.();
  if (uid === undefined || gid === undefined) {
    throw new Error('This test requires a POSIX runtime with getuid/getgid support.');
  }

  return {
    SUDO_GID: String(gid),
    SUDO_UID: String(uid),
  };
}

function restoreEnvValue(name: keyof ConfigStoreTestEnv, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

function restoreConfigStoreEnv(): void {
  restoreEnvValue('HOME', originalEnv.HOME);
  restoreEnvValue('COMPARTMENT_CLI_CONFIG_DIR', originalEnv.COMPARTMENT_CLI_CONFIG_DIR);
  restoreEnvValue('SUDO_GID', originalEnv.SUDO_GID);
  restoreEnvValue('SUDO_UID', originalEnv.SUDO_UID);
  restoreEnvValue('SUDO_USER', originalEnv.SUDO_USER);
  restoreEnvValue('XDG_CONFIG_HOME', originalEnv.XDG_CONFIG_HOME);
}

afterEach(async (): Promise<void> => {
  restoreConfigStoreEnv();
  for (const directory of createdDirectories.splice(0)) {
    await rm(directory, { force: true, recursive: true });
  }
});

describe('cli config store', (): void => {
  it('returns an empty config when the config file does not exist', async (): Promise<void> => {
    process.env.COMPARTMENT_CLI_CONFIG_DIR = await createTempDirectory('compartment-cli-config-store-');

    await expect(readCliConfig()).resolves.toEqual({});
  });

  it('writes and reads the exact persisted config shape', async (): Promise<void> => {
    const configDirectory: string = await createTempDirectory('compartment-cli-config-store-');
    const config: CliConfig = createCliConfigFixture({
      apiUrl: 'https://api.example.com',
      currentOrganization: createCliOrganizationFixture({
        id: 'org_1',
        name: 'Acme',
        slug: 'acme',
      }),
      sessionToken: 'session-token',
    });

    process.env.COMPARTMENT_CLI_CONFIG_DIR = configDirectory;

    await writeCliConfig(config);

    await expect(readCliConfig()).resolves.toEqual(config);
    await expect(readFile(join(configDirectory, 'config.json'), 'utf8')).resolves.toContain(
      '"sessionToken": "session-token"',
    );
  });

  it('prefers COMPARTMENT_CLI_CONFIG_DIR over XDG_CONFIG_HOME', async (): Promise<void> => {
    const configDirectory: string = await createTempDirectory('compartment-cli-config-dir-');
    const xdgDirectory: string = await createTempDirectory('compartment-cli-xdg-dir-');

    process.env.COMPARTMENT_CLI_CONFIG_DIR = configDirectory;
    process.env.XDG_CONFIG_HOME = xdgDirectory;

    await writeCliConfig(
      createCliConfigFixture({
        apiUrl: 'https://api.example.com',
      }),
    );

    await expect(readFile(join(configDirectory, 'config.json'), 'utf8')).resolves.toContain('https://api.example.com');
    await expect(readCliConfig()).resolves.toEqual(
      createCliConfigFixture({
        apiUrl: 'https://api.example.com',
      }),
    );
  });

  it('uses XDG_CONFIG_HOME when COMPARTMENT_CLI_CONFIG_DIR is not set', async (): Promise<void> => {
    const xdgDirectory: string = await createTempDirectory('compartment-cli-xdg-dir-');

    delete process.env.COMPARTMENT_CLI_CONFIG_DIR;
    process.env.XDG_CONFIG_HOME = xdgDirectory;

    await writeCliConfig(
      createCliConfigFixture({
        apiUrl: 'https://api.example.com',
      }),
    );

    await expect(readFile(join(xdgDirectory, 'compartment-cli', 'config.json'), 'utf8')).resolves.toContain(
      'https://api.example.com',
    );
  });

  it('rejects a symlink config file without clobbering the target file', async (): Promise<void> => {
    const configDirectory: string = await createTempDirectory('compartment-cli-symlink-config-');
    const victimPath: string = join(configDirectory, 'victim.json');
    const configPath: string = join(configDirectory, 'config.json');

    process.env.COMPARTMENT_CLI_CONFIG_DIR = configDirectory;
    await writeFile(victimPath, 'victim-config\n', 'utf8');
    await chmod(victimPath, 0o644);
    await symlink(victimPath, configPath);

    await expect(
      writeCliConfig(
        createCliConfigFixture({
          apiUrl: 'https://api.example.com',
        }),
      ),
    ).rejects.toThrow('Refusing to write CLI config through non-regular file path');

    await expect(readFile(victimPath, 'utf8')).resolves.toBe('victim-config\n');
    expect((await stat(victimPath)).mode & 0o777).toBe(0o644);
  });

  it('rejects a symlink config directory before writing config', async (): Promise<void> => {
    const parentDirectory: string = await createTempDirectory('compartment-cli-symlink-dir-');
    const realDirectory: string = join(parentDirectory, 'real-config');
    const symlinkDirectory: string = join(parentDirectory, 'linked-config');

    await mkdir(realDirectory);
    await symlink(realDirectory, symlinkDirectory);
    process.env.COMPARTMENT_CLI_CONFIG_DIR = symlinkDirectory;

    await expect(
      writeCliConfig(
        createCliConfigFixture({
          apiUrl: 'https://api.example.com',
        }),
      ),
    ).rejects.toThrow('Refusing to write CLI config through non-directory path');

    await expect(readFile(join(realDirectory, 'config.json'), 'utf8')).rejects.toThrow();
  });

  it('preserves XDG_CONFIG_HOME when writing config after sudo', async (): Promise<void> => {
    const xdgDirectory: string = await createTempDirectory('compartment-cli-sudo-xdg-dir-');
    const fileOwnerEnv: Pick<ConfigStoreTestEnv, 'SUDO_GID' | 'SUDO_UID'> = readCurrentFileOwnerEnv();

    delete process.env.COMPARTMENT_CLI_CONFIG_DIR;
    process.env.SUDO_USER = 'platform-user';
    process.env.SUDO_UID = fileOwnerEnv.SUDO_UID;
    process.env.SUDO_GID = fileOwnerEnv.SUDO_GID;
    process.env.XDG_CONFIG_HOME = xdgDirectory;

    await writeCliConfig(
      createCliConfigFixture({
        apiUrl: 'https://api.example.com',
      }),
    );

    await expect(readFile(join(xdgDirectory, 'compartment-cli', 'config.json'), 'utf8')).resolves.toContain(
      'https://api.example.com',
    );
  });

  it('fails before writing sudo user config when sudo ownership env is invalid', async (): Promise<void> => {
    const xdgDirectory: string = await createTempDirectory('compartment-cli-sudo-invalid-owner-dir-');
    const configPath: string = join(xdgDirectory, 'compartment-cli', 'config.json');

    delete process.env.COMPARTMENT_CLI_CONFIG_DIR;
    process.env.SUDO_USER = 'platform-user';
    process.env.SUDO_UID = 'bad-uid';
    process.env.SUDO_GID = 'bad-gid';
    process.env.XDG_CONFIG_HOME = xdgDirectory;

    await expect(
      writeCliConfig(
        createCliConfigFixture({
          apiUrl: 'https://api.example.com',
        }),
      ),
    ).rejects.toThrow('Cannot write CLI config for target user because owner uid and gid are missing or invalid.');
    await expect(readFile(configPath, 'utf8')).rejects.toThrow();
  });

  it('falls back to HOME/.config when no explicit config directory is configured', async (): Promise<void> => {
    const homeDirectory: string = await createTempDirectory('compartment-cli-home-dir-');

    delete process.env.COMPARTMENT_CLI_CONFIG_DIR;
    delete process.env.XDG_CONFIG_HOME;
    process.env.HOME = homeDirectory;

    await writeCliConfig(
      createCliConfigFixture({
        apiUrl: 'https://api.example.com',
      }),
    );

    await expect(readFile(join(homeDirectory, '.config', 'compartment-cli', 'config.json'), 'utf8')).resolves.toContain(
      'https://api.example.com',
    );
    await clearCliConfig();
    await expect(readCliConfig()).resolves.toEqual({});
  });
});
