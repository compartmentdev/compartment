import type { Stats } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readFileModePermissions } from '@compartment/test-support';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import type { BundledAssets, StagedAssetPaths } from '../src/runtime-assets.types';

interface SeaModule {
  readSeaAssetText: (assetName: string) => string;
}

interface RuntimeComposeNamedNetwork {
  name?: string;
}

interface RuntimeComposeFile {
  networks?: Record<string, RuntimeComposeNamedNetwork | null>;
  services?: Record<string, RuntimeComposeService>;
  volumes?: Record<string, null>;
}

type RuntimeComposeServiceNetworks = readonly string[] | Record<string, null>;

interface RuntimeComposeHealthcheck {
  test?: readonly string[];
}

interface RuntimeComposeService {
  cap_add?: readonly string[];
  cap_drop?: readonly string[];
  command?: readonly string[];
  environment?: Record<string, string>;
  env_file?: string | readonly string[];
  healthcheck?: RuntimeComposeHealthcheck;
  image?: string;
  networks?: RuntimeComposeServiceNetworks;
  privileged?: boolean;
  pull_policy?: string;
  read_only?: boolean;
  security_opt?: readonly string[];
  tmpfs?: readonly string[];
  user?: string;
  volumes?: readonly string[];
}

const bundledAssetFilenames: readonly string[] = [
  'docker-compose.self-hosted.yml',
  'docker-compose.self-hosted.local.yml',
  '.env.self-hosted.example',
];

const resetPasswordThrottleComposeEnvNames: readonly string[] = [
  'COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_ROUTE_MAX_REQUESTS',
  'COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_ROUTE_WINDOW',
  'COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SOURCE_MAX_FAILURES',
  'COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SOURCE_WINDOW',
  'COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SOURCE_BLOCK',
  'COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SUBJECT_MAX_FAILURES',
  'COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SUBJECT_WINDOW',
  'COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SUBJECT_BLOCK',
  'COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SOURCE_SUBJECT_MAX_FAILURES',
  'COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SOURCE_SUBJECT_WINDOW',
  'COMPARTMENT_THROTTLE_AUTH_RESET_PASSWORD_SOURCE_SUBJECT_BLOCK',
];

describe.sequential('runtime assets', (): void => {
  let tempDirectory: string | undefined;

  beforeEach((): void => {
    vi.resetModules();
  });

  afterEach(async (): Promise<void> => {
    vi.doUnmock('../src/sea');

    if (tempDirectory !== undefined) {
      await rm(tempDirectory, { force: true, recursive: true });
      tempDirectory = undefined;
    }
  });

  it('prefers embedded SEA assets when they are available', async (): Promise<void> => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'compartment-runtime-assets-'));
    const configDir: string = join(tempDirectory, 'etc');
    const dataDir: string = join(tempDirectory, 'var');
    vi.doMock(
      '../src/sea',
      (): SeaModule => ({
        readSeaAssetText: (assetName: string): string => {
          if (assetName === 'docker-compose.self-hosted.yml') {
            return 'services:\n';
          }

          if (assetName === 'docker-compose.self-hosted.local.yml') {
            return 'pull_policy: never\n';
          }

          if (assetName === '.env.self-hosted.example') {
            return 'COMPARTMENT_NODE_VERSION=0.2.0\n';
          }

          throw new Error(`Unexpected SEA asset ${assetName}`);
        },
      }),
    );

    const { buildStagedAssetPaths, readBundledAssets, readBundledEnvTemplate, stageBundledAssets } =
      await import('../src/runtime-assets');

    const stagedAssetPaths: StagedAssetPaths = buildStagedAssetPaths(configDir, dataDir);
    const bundledAssets: BundledAssets = readBundledAssets(join(tempDirectory, 'ignored'));

    await expect(readBundledEnvTemplate(bundledAssets)).resolves.toBe('COMPARTMENT_NODE_VERSION=0.2.0\n');
    await stageBundledAssets(stagedAssetPaths, bundledAssets);
    await expect(readFile(stagedAssetPaths.composePath, 'utf8')).resolves.toBe('services:\n');
    await expect(readFile(stagedAssetPaths.localComposePath, 'utf8')).resolves.toBe('pull_policy: never\n');
  });

  it('stages the bundled compose asset with isolated database and build network topology', async (): Promise<void> => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'compartment-runtime-assets-'));
    const configDir: string = join(tempDirectory, 'etc');
    const dataDir: string = join(tempDirectory, 'var');
    const { buildStagedAssetPaths, readBundledAssets, stageBundledAssets } = await import('../src/runtime-assets');
    const packageDirectory: string = await createBundledPackageDirectory(tempDirectory);

    const stagedAssetPaths: StagedAssetPaths = buildStagedAssetPaths(configDir, dataDir);
    const bundledAssets: BundledAssets = readBundledAssets(packageDirectory);

    await stageBundledAssets(stagedAssetPaths, bundledAssets);

    const composeFile: RuntimeComposeFile = parse(
      await readFile(stagedAssetPaths.composePath, 'utf8'),
    ) as RuntimeComposeFile;
    expect(composeFile.networks).toHaveProperty('db_internal');
    expect(composeFile.networks).toHaveProperty('build_internal');
    expect(readServiceNetworks(composeFile, 'api-migrate')).toEqual(['db_internal', 'system_internal']);
    expect(readServiceNetworks(composeFile, 'api')).toEqual(['db_internal', 'system_internal']);
    expect(readServiceNetworks(composeFile, 'postgres')).toEqual(['db_internal']);
    expect(readServiceNetworks(composeFile, 'registry')).toEqual(['system_internal']);
    expect(readServiceNetworks(composeFile, 'registry-auth')).toEqual(['build_internal', 'system_internal']);
    expect(readServiceNetworks(composeFile, 'builder')).toEqual(['build_internal']);
    expect(readServiceNetworks(composeFile, 'edge')).toEqual(['system_internal']);
    expect(composeFile.services).not.toHaveProperty('node');
    expect(readServiceNetworks(composeFile, 'worker')).toEqual(['system_internal']);
    expect(readServiceNetworks(composeFile, 'caddy')).toEqual(['system_internal']);
  });

  it('stages the bundled compose asset with a rootful internal BuildKit service', async (): Promise<void> => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'compartment-runtime-assets-'));
    const configDir: string = join(tempDirectory, 'etc');
    const dataDir: string = join(tempDirectory, 'var');
    const { buildStagedAssetPaths, readBundledAssets, stageBundledAssets } = await import('../src/runtime-assets');
    const packageDirectory: string = await createBundledPackageDirectory(tempDirectory);

    const stagedAssetPaths: StagedAssetPaths = buildStagedAssetPaths(configDir, dataDir);
    const bundledAssets: BundledAssets = readBundledAssets(packageDirectory);

    await stageBundledAssets(stagedAssetPaths, bundledAssets);

    const composeFile: RuntimeComposeFile = parse(
      await readFile(stagedAssetPaths.composePath, 'utf8'),
    ) as RuntimeComposeFile;
    const localComposeFile: RuntimeComposeFile = parse(
      await readFile(stagedAssetPaths.localComposePath, 'utf8'),
    ) as RuntimeComposeFile;
    const builderService: RuntimeComposeService = readService(composeFile, 'builder');
    const composeText: string = await readFile(stagedAssetPaths.composePath, 'utf8');

    expect(builderService.image).toBe('${COMPARTMENT_BUILDER_IMAGE}');
    expect(builderService.command).toEqual([
      '--addr',
      'unix:///run/buildkit/buildkitd.sock',
      '--group',
      '${COMPARTMENT_RUNTIME_GID}',
      '--oci-worker-net',
      'bridge',
    ]);
    expect(builderService.healthcheck?.test).toEqual([
      'CMD',
      'buildctl',
      '--addr',
      'unix:///run/buildkit/buildkitd.sock',
      'debug',
      'workers',
    ]);
    expect(builderService.privileged).toBe(true);
    expect(readService(localComposeFile, 'builder').pull_policy).toBe('never');
    expect(builderService.security_opt).toBeUndefined();
    expect(builderService.volumes).toEqual([
      'compartment-buildkit-socket:/run/buildkit',
      'compartment-buildkit-rootful-state:/var/lib/buildkit',
    ]);
    expect(readServiceEnvironment(composeFile, 'worker').BUILDKIT_ADDR).toBe('${BUILDKIT_ADDR}');
    expect(readServiceEnvironment(composeFile, 'worker').DOCKER_CONFIG).toBe('/tmp/.docker');
    expect(readServiceVolumes(composeFile, 'worker')).toContain('compartment-buildkit-socket:/run/buildkit:ro');
    expect(composeFile.volumes).toHaveProperty('compartment-buildkit-socket');
    expect(composeText).not.toContain('tcp://0.0.0.0:1234');
    expect(composeText).not.toContain('tcp://127.0.0.1:1234');
    expect(composeText).not.toContain('tcp://builder:1234');
  });

  it('stages the bundled compose asset with read-only hardened system services', async (): Promise<void> => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'compartment-runtime-assets-'));
    const configDir: string = join(tempDirectory, 'etc');
    const dataDir: string = join(tempDirectory, 'var');
    const { buildStagedAssetPaths, readBundledAssets, stageBundledAssets } = await import('../src/runtime-assets');
    const packageDirectory: string = await createBundledPackageDirectory(tempDirectory);

    const stagedAssetPaths: StagedAssetPaths = buildStagedAssetPaths(configDir, dataDir);
    const bundledAssets: BundledAssets = readBundledAssets(packageDirectory);

    await stageBundledAssets(stagedAssetPaths, bundledAssets);

    const composeFile: RuntimeComposeFile = parse(
      await readFile(stagedAssetPaths.composePath, 'utf8'),
    ) as RuntimeComposeFile;

    expect(readService(composeFile, 'api').user).toBe('${COMPARTMENT_RUNTIME_UID}:${COMPARTMENT_RUNTIME_GID}');
    expect(readService(composeFile, 'worker').user).toBe('${COMPARTMENT_RUNTIME_UID}:${COMPARTMENT_RUNTIME_GID}');
    expect(readService(composeFile, 'caddy').user).toBe('0:${COMPARTMENT_RUNTIME_GID}');
    for (const serviceName of ['api-migrate', 'api', 'edge']) {
      expect(readService(composeFile, serviceName)).toMatchObject({
        cap_drop: ['ALL'],
        read_only: true,
        security_opt: ['no-new-privileges:true'],
      });
      expect(readService(composeFile, serviceName).tmpfs).toContain('/tmp:rw,noexec,nosuid,nodev,size=64m');
    }
    expect(readService(composeFile, 'worker')).toMatchObject({
      cap_drop: ['ALL'],
      read_only: true,
      security_opt: ['no-new-privileges:true'],
      tmpfs: ['/tmp:rw,exec,nosuid,nodev,size=1g'],
    });
    for (const serviceName of ['registry', 'registry-auth']) {
      expect(readService(composeFile, serviceName)).toMatchObject({
        cap_drop: ['ALL'],
        read_only: true,
        security_opt: ['no-new-privileges:true'],
      });
    }
    expect(readService(composeFile, 'registry').tmpfs).toEqual(['/tmp:rw,noexec,nosuid,nodev,size=32m']);
    expect(readService(composeFile, 'registry-auth').tmpfs).toEqual(['/tmp:rw,noexec,nosuid,nodev,size=32m']);
    expect(readService(composeFile, 'caddy')).toMatchObject({
      cap_add: ['NET_BIND_SERVICE'],
      cap_drop: ['ALL'],
      read_only: true,
      security_opt: ['no-new-privileges:true'],
      tmpfs: ['/config:rw,noexec,nosuid,nodev,size=32m', '/tmp:rw,noexec,nosuid,nodev,size=32m'],
    });
    expect(readService(composeFile, 'postgres')).toMatchObject({
      cap_add: ['CHOWN', 'DAC_OVERRIDE', 'FOWNER', 'SETGID', 'SETUID'],
      cap_drop: ['ALL'],
      read_only: true,
      security_opt: ['no-new-privileges:true'],
      tmpfs: ['/tmp:rw,noexec,nosuid,nodev,size=64m', '/var/run/postgresql:rw,noexec,nosuid,nodev,size=8m'],
    });
    expect(readService(composeFile, 'builder').read_only).toBeUndefined();
  });

  it('stages the bundled compose asset without leaking the system API token to non-API services', async (): Promise<void> => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'compartment-runtime-assets-'));
    const configDir: string = join(tempDirectory, 'etc');
    const dataDir: string = join(tempDirectory, 'var');
    const { buildStagedAssetPaths, readBundledAssets, stageBundledAssets } = await import('../src/runtime-assets');
    const packageDirectory: string = await createBundledPackageDirectory(tempDirectory);

    const stagedAssetPaths: StagedAssetPaths = buildStagedAssetPaths(configDir, dataDir);
    const bundledAssets: BundledAssets = readBundledAssets(packageDirectory);

    await stageBundledAssets(stagedAssetPaths, bundledAssets);

    const composeFile: RuntimeComposeFile = parse(
      await readFile(stagedAssetPaths.composePath, 'utf8'),
    ) as RuntimeComposeFile;

    for (const serviceName of readServiceNames(composeFile)) {
      expect(readService(composeFile, serviceName).env_file).toBeUndefined();
    }
    expect(readServiceEnvironment(composeFile, 'api').COMPARTMENT_SYSTEM_TOKEN).toBe('${COMPARTMENT_SYSTEM_TOKEN}');
    for (const serviceName of ['api-migrate', 'builder', 'edge', 'worker', 'caddy', 'postgres', 'registry']) {
      expect(readServiceEnvironment(composeFile, serviceName).COMPARTMENT_SYSTEM_TOKEN).toBeUndefined();
      expect(readServiceEnvironment(composeFile, serviceName).COMPARTMENT_SYSTEM_API_SOCKET).toBeUndefined();
    }
  });

  it('mounts only Compartment agent sockets into compose services that need them', async (): Promise<void> => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'compartment-runtime-assets-'));
    const configDir: string = join(tempDirectory, 'etc');
    const dataDir: string = join(tempDirectory, 'var');
    const { buildStagedAssetPaths, readBundledAssets, stageBundledAssets } = await import('../src/runtime-assets');
    const packageDirectory: string = await createBundledPackageDirectory(tempDirectory);

    const stagedAssetPaths: StagedAssetPaths = buildStagedAssetPaths(configDir, dataDir);
    const bundledAssets: BundledAssets = readBundledAssets(packageDirectory);

    await stageBundledAssets(stagedAssetPaths, bundledAssets);

    const composeFile: RuntimeComposeFile = parse(
      await readFile(stagedAssetPaths.composePath, 'utf8'),
    ) as RuntimeComposeFile;

    expect(readServiceVolumes(composeFile, 'api')).toEqual(
      expect.arrayContaining([
        '${COMPARTMENT_SOURCE_ARCHIVE_DIR}:${COMPARTMENT_SOURCE_ARCHIVE_DIR}',
        '/var/run/compartment/api:/var/run/compartment/api',
        '/var/run/compartment/node:/var/run/compartment/node',
      ]),
    );
    expect(readServiceVolumes(composeFile, 'api')).not.toContain(
      'compartment-source-archives:/var/lib/compartment/source-archives',
    );
    expect(readServiceVolumes(composeFile, 'worker')).toEqual(
      expect.arrayContaining(['/var/run/compartment/node:/var/run/compartment/node']),
    );
    expect(readServiceVolumes(composeFile, 'worker')).not.toContain(
      '/var/run/compartment/api:/var/run/compartment/api',
    );
    for (const serviceName of Object.keys(composeFile.services ?? {})) {
      expect(readServiceVolumes(composeFile, serviceName)).not.toContain('/var/run/docker.sock:/var/run/docker.sock');
    }
    expect(composeFile.volumes).not.toHaveProperty('compartment-source-archives');
  });

  it('stages the self-hosted Docker work directory with private permissions', async (): Promise<void> => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'compartment-runtime-assets-'));
    const configDir: string = join(tempDirectory, 'etc');
    const dataDir: string = join(tempDirectory, 'var');
    const { buildStagedAssetPaths, readBundledAssets, stageBundledAssets } = await import('../src/runtime-assets');
    const packageDirectory: string = await createBundledPackageDirectory(tempDirectory);

    const stagedAssetPaths: StagedAssetPaths = buildStagedAssetPaths(configDir, dataDir);
    const bundledAssets: BundledAssets = readBundledAssets(packageDirectory);

    await stageBundledAssets(stagedAssetPaths, bundledAssets);

    const dockerWorkStats: Stats = await stat(stagedAssetPaths.dockerWorkDirectory);
    expect(dockerWorkStats.isDirectory()).toBe(true);
    expect(readFileModePermissions(dockerWorkStats.mode)).toBe(0o700);
  });

  it('passes the custom TLS directory to the API service', async (): Promise<void> => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'compartment-runtime-assets-'));
    const configDir: string = join(tempDirectory, 'etc');
    const dataDir: string = join(tempDirectory, 'var');
    const { buildStagedAssetPaths, readBundledAssets, stageBundledAssets } = await import('../src/runtime-assets');
    const packageDirectory: string = await createBundledPackageDirectory(tempDirectory);

    const stagedAssetPaths: StagedAssetPaths = buildStagedAssetPaths(configDir, dataDir);
    const bundledAssets: BundledAssets = readBundledAssets(packageDirectory);

    await stageBundledAssets(stagedAssetPaths, bundledAssets);

    const composeFile: RuntimeComposeFile = parse(
      await readFile(stagedAssetPaths.composePath, 'utf8'),
    ) as RuntimeComposeFile;

    expect(readServiceEnvironment(composeFile, 'api').COMPARTMENT_CUSTOM_TLS_DIR).toBe('${COMPARTMENT_CUSTOM_TLS_DIR}');
    expect(readServiceVolumes(composeFile, 'api')).toContain(
      '${COMPARTMENT_CUSTOM_TLS_DIR}:${COMPARTMENT_CUSTOM_TLS_DIR}:ro',
    );
    expect(readServiceVolumes(composeFile, 'caddy')).toContain(
      '${COMPARTMENT_CUSTOM_TLS_DIR}:${COMPARTMENT_CUSTOM_TLS_DIR}:ro',
    );
  });

  it('passes self-hosted validation inputs to the API service', async (): Promise<void> => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'compartment-runtime-assets-'));
    const configDir: string = join(tempDirectory, 'etc');
    const dataDir: string = join(tempDirectory, 'var');
    const { buildStagedAssetPaths, readBundledAssets, stageBundledAssets } = await import('../src/runtime-assets');
    const packageDirectory: string = await createBundledPackageDirectory(tempDirectory);

    const stagedAssetPaths: StagedAssetPaths = buildStagedAssetPaths(configDir, dataDir);
    const bundledAssets: BundledAssets = readBundledAssets(packageDirectory);

    await stageBundledAssets(stagedAssetPaths, bundledAssets);

    const composeFile: RuntimeComposeFile = parse(
      await readFile(stagedAssetPaths.composePath, 'utf8'),
    ) as RuntimeComposeFile;
    const apiEnvironment: Record<string, string> = readServiceEnvironment(composeFile, 'api');

    expect(apiEnvironment.COMPARTMENT_ENV).toBe('${COMPARTMENT_ENV}');
    expect(apiEnvironment.COMPARTMENT_POSTGRES_PASSWORD).toBe('${COMPARTMENT_POSTGRES_PASSWORD}');
    expect(readServiceEnvironment(composeFile, 'api-migrate').COMPARTMENT_ENV).toBeUndefined();
    expect(readServiceEnvironment(composeFile, 'api-migrate').COMPARTMENT_POSTGRES_PASSWORD).toBeUndefined();
  });

  it('passes reset-password throttle settings to the API service', async (): Promise<void> => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'compartment-runtime-assets-'));
    const configDir: string = join(tempDirectory, 'etc');
    const dataDir: string = join(tempDirectory, 'var');
    const { buildStagedAssetPaths, readBundledAssets, stageBundledAssets } = await import('../src/runtime-assets');
    const packageDirectory: string = await createBundledPackageDirectory(tempDirectory);

    const stagedAssetPaths: StagedAssetPaths = buildStagedAssetPaths(configDir, dataDir);
    const bundledAssets: BundledAssets = readBundledAssets(packageDirectory);

    await stageBundledAssets(stagedAssetPaths, bundledAssets);

    const composeFile: RuntimeComposeFile = parse(
      await readFile(stagedAssetPaths.composePath, 'utf8'),
    ) as RuntimeComposeFile;
    const apiEnvironment: Record<string, string> = readServiceEnvironment(composeFile, 'api');

    for (const envName of resetPasswordThrottleComposeEnvNames) {
      expect(apiEnvironment[envName]).toBe(`\${${envName}}`);
    }
  });
});

function readServiceNetworks(composeFile: RuntimeComposeFile, serviceName: string): string[] {
  const service: RuntimeComposeService = readService(composeFile, serviceName);
  if (isServiceNetworkList(service.networks)) {
    return service.networks.toSorted(compareText);
  }

  if (service.networks !== undefined) {
    return Object.keys(service.networks).sort(compareText);
  }

  return [];
}

function readServiceEnvironment(composeFile: RuntimeComposeFile, serviceName: string): Record<string, string> {
  return readService(composeFile, serviceName).environment ?? {};
}

function readServiceVolumes(composeFile: RuntimeComposeFile, serviceName: string): readonly string[] {
  return readService(composeFile, serviceName).volumes ?? [];
}

function readService(composeFile: RuntimeComposeFile, serviceName: string): RuntimeComposeService {
  const service: RuntimeComposeService | undefined = composeFile.services?.[serviceName];
  if (service === undefined) {
    throw new Error(`Missing service ${serviceName} in bundled compose asset.`);
  }

  return service;
}

function readServiceNames(composeFile: RuntimeComposeFile): string[] {
  if (composeFile.services === undefined) {
    throw new Error('Missing services in bundled compose asset.');
  }

  return Object.keys(composeFile.services);
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right);
}

async function createBundledPackageDirectory(tempDirectory: string): Promise<string> {
  const packageDirectory: string = join(tempDirectory, 'package');
  const assetsDirectory: string = join(packageDirectory, 'assets');
  await mkdir(assetsDirectory, { recursive: true });

  for (const assetFilename of bundledAssetFilenames) {
    const sourcePath: string = resolve(__dirname, '../../..', assetFilename);
    await cp(sourcePath, join(assetsDirectory, assetFilename));
  }

  return packageDirectory;
}

function isServiceNetworkList(networks: RuntimeComposeServiceNetworks | undefined): networks is readonly string[] {
  return Array.isArray(networks);
}
