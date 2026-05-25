import { constants as fsConstants } from 'node:fs';
import { access, chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
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

  return [await readBundledCosignPath()];
}

async function readBundledCosignPath(): Promise<string> {
  bundledCosignPathPromise ??= extractBundledCosign();
  return await bundledCosignPathPromise;
}

async function extractBundledCosign(): Promise<string> {
  const asset: Buffer | undefined = readSeaAssetBuffer(bundledCosignAssetName);
  if (asset === undefined) {
    throw new Error(`Missing embedded CLI asset ${bundledCosignAssetName}.`);
  }

  const extractionDirectory: string = await createBundledCosignExtractionDirectory(asset);
  const cosignPath: string = join(extractionDirectory, 'cosign');
  if (await canAccessExecutablePath(cosignPath)) {
    return cosignPath;
  }

  await writeBundledCosignExecutable(extractionDirectory, cosignPath, asset);
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
  if (configuredCacheDirectory !== undefined && configuredCacheDirectory !== '') {
    return configuredCacheDirectory;
  }

  return join(homedir(), '.cache');
}

async function canAccessExecutablePath(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}
