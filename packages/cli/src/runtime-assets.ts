import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { ensureSelfHostedPrivateDirectory } from './self-hosted-file-permissions';
import { readSeaAssetText } from './sea';
import type { BundledAssets, BundledRuntimeAsset, StagedAssetPaths } from './runtime-assets.types';

const bundledAssetsDirectoryName: string = 'assets';
const composeFilename: string = 'docker-compose.self-hosted.yml';
const localComposeFilename: string = 'docker-compose.self-hosted.local.yml';
const envExampleFilename: string = '.env.self-hosted.example';
const legacyRuntimeName: string = ['on', 'prem'].join('');
const legacyComposeFilename: string = `docker-compose.${legacyRuntimeName}.yml`;
const legacyLocalComposeFilename: string = `docker-compose.${legacyRuntimeName}.local.yml`;
const legacyEnvFilename: string = `.env.${legacyRuntimeName}`;

export function readBundledAssets(currentDirectory: string = __dirname): BundledAssets {
  const seaAssets: BundledAssets | undefined = readSeaBundledAssets();
  if (seaAssets !== undefined) {
    return seaAssets;
  }

  const assetsDirectory: string = resolve(currentDirectory, bundledAssetsDirectoryName);
  if (hasBundledAssets(assetsDirectory)) {
    return buildFilesystemBundledAssets(assetsDirectory);
  }

  const repositoryRoot: string = resolve(currentDirectory, '../../..');
  return buildFilesystemBundledAssets(repositoryRoot);
}

export async function readBundledEnvTemplate(assetPaths: BundledAssets): Promise<string> {
  return await readBundledAssetText(assetPaths.envTemplate);
}

export function buildStagedAssetPaths(configDir: string, dataDir: string): StagedAssetPaths {
  return {
    configDir,
    composePath: resolve(configDir, composeFilename),
    dataDir,
    dockerWorkDirectory: resolve(dataDir, 'self-hosted/docker-work'),
    envPath: resolve(configDir, '.env.self-hosted'),
    localComposePath: resolve(configDir, localComposeFilename),
  };
}

export function buildLegacyStagedAssetPaths(configDir: string, dataDir: string): StagedAssetPaths {
  return {
    configDir,
    composePath: resolve(configDir, legacyComposeFilename),
    dataDir,
    dockerWorkDirectory: resolve(dataDir, legacyRuntimeName, 'docker-work'),
    envPath: resolve(configDir, legacyEnvFilename),
    localComposePath: resolve(configDir, legacyLocalComposeFilename),
  };
}

export async function stageBundledAssets(stagedPaths: StagedAssetPaths, assetPaths: BundledAssets): Promise<void> {
  await ensureSelfHostedPrivateDirectory(stagedPaths.dockerWorkDirectory);
  await writeBundledAsset(assetPaths.compose, stagedPaths.composePath);
  await writeBundledAsset(assetPaths.localCompose, stagedPaths.localComposePath);
}

async function writeBundledAsset(asset: BundledRuntimeAsset, destinationPath: string): Promise<void> {
  await ensureSelfHostedPrivateDirectory(dirname(destinationPath));
  await writeFile(destinationPath, await readBundledAssetText(asset), 'utf8');
}

function hasBundledAssets(assetsDirectory: string): boolean {
  return (
    existsSync(resolve(assetsDirectory, composeFilename)) &&
    existsSync(resolve(assetsDirectory, localComposeFilename)) &&
    existsSync(resolve(assetsDirectory, envExampleFilename))
  );
}

function buildFilesystemBundledAssets(assetsDirectory: string): BundledAssets {
  return {
    compose: {
      kind: 'file',
      path: resolve(assetsDirectory, composeFilename),
    },
    envTemplate: {
      kind: 'file',
      path: resolve(assetsDirectory, envExampleFilename),
    },
    localCompose: {
      kind: 'file',
      path: resolve(assetsDirectory, localComposeFilename),
    },
  };
}

function readSeaBundledAssets(): BundledAssets | undefined {
  const composeText: string | undefined = readSeaAssetText(composeFilename);
  if (composeText === undefined) {
    return undefined;
  }

  return {
    compose: {
      kind: 'inline',
      text: composeText,
    },
    envTemplate: {
      kind: 'inline',
      text: readRequiredSeaAssetText(envExampleFilename),
    },
    localCompose: {
      kind: 'inline',
      text: readRequiredSeaAssetText(localComposeFilename),
    },
  };
}

async function readBundledAssetText(asset: BundledRuntimeAsset): Promise<string> {
  if (asset.kind === 'inline') {
    return asset.text;
  }

  return await readFile(asset.path, 'utf8');
}

function readRequiredSeaAssetText(assetName: string): string {
  const assetText: string | undefined = readSeaAssetText(assetName);
  if (assetText !== undefined) {
    return assetText;
  }

  throw new Error(`Missing embedded CLI asset ${assetName}.`);
}
