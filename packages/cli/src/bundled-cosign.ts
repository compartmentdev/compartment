import { createHash, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access, chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isSeaRuntime, readSeaAssetBuffer } from './sea';

const bundledCosignAssetName: string = 'cosign';
const bundledCosignDirectoryMode: number = 0o700;
const bundledCosignFileMode: number = 0o700;
let bundledCosignPathPromise: Promise<string> | undefined;

export async function readCosignCommand(): Promise<readonly string[]> {
  if (!isSeaRuntime()) {
    return ['cosign'];
  }

  bundledCosignPathPromise ??= extractBundledCosignAsset();
  const bundledCosignPath: string = await bundledCosignPathPromise;
  return [bundledCosignPath];
}

async function extractBundledCosignAsset(): Promise<string> {
  const asset: Buffer | undefined = readSeaAssetBuffer(bundledCosignAssetName);
  if (asset === undefined) {
    throw new Error(`Missing embedded CLI asset ${bundledCosignAssetName}.`);
  }
  return await extractBundledCosign(asset);
}

async function extractBundledCosign(asset: Buffer): Promise<string> {
  const extractionDirectory: string = await createBundledCosignExtractionDirectory(asset);
  const cosignPath: string = join(extractionDirectory, bundledCosignAssetName);
  if (!(await canAccessExecutablePath(cosignPath))) {
    await writeBundledCosignExecutable(extractionDirectory, cosignPath, asset);
  }
  return cosignPath;
}

async function writeBundledCosignExecutable(
  extractionDirectory: string,
  cosignPath: string,
  asset: Buffer,
): Promise<void> {
  const temporaryCosignPath: string = join(extractionDirectory, `cosign-${process.pid}-${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryCosignPath, asset, { mode: bundledCosignFileMode });
    await chmod(temporaryCosignPath, bundledCosignFileMode);
    await rename(temporaryCosignPath, cosignPath);
    await chmod(cosignPath, bundledCosignFileMode);
  } catch (error) {
    await rm(temporaryCosignPath, { force: true });
    throw error;
  }
}

async function createBundledCosignExtractionDirectory(asset: Buffer): Promise<string> {
  const compartmentCacheDirectory: string = join(readUserCacheDirectory(), 'compartment');
  const extractionDirectory: string = join(
    compartmentCacheDirectory,
    'cosign',
    createHash('sha256').update(asset).digest('hex'),
  );
  await mkdir(extractionDirectory, { mode: bundledCosignDirectoryMode, recursive: true });
  await chmod(compartmentCacheDirectory, bundledCosignDirectoryMode);
  await chmod(extractionDirectory, bundledCosignDirectoryMode);
  return extractionDirectory;
}

function readUserCacheDirectory(): string {
  const configuredCacheDirectory: string | undefined = process.env.XDG_CACHE_HOME?.trim();
  return configuredCacheDirectory === undefined || configuredCacheDirectory === ''
    ? join(homedir(), '.cache')
    : configuredCacheDirectory;
}

async function canAccessExecutablePath(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}
