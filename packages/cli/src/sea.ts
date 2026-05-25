import { getAsset, isSea } from 'node:sea';

export function readSeaAssetText(assetName: string): string | undefined {
  if (!isSeaRuntime()) {
    return undefined;
  }

  return getAsset(assetName, 'utf8');
}

export function readSeaAssetBuffer(assetName: string): Buffer | undefined {
  if (!isSeaRuntime()) {
    return undefined;
  }

  return Buffer.from(getAsset(assetName));
}

export function isSeaRuntime(): boolean {
  return isSea();
}
