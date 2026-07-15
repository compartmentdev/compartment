import { getAsset, isSea } from 'node:sea';

export function readSeaAssetText(assetName: string): string | undefined {
  if (!isSeaRuntime()) {
    return undefined;
  }

  return getAsset(assetName, 'utf8');
}

function isSeaRuntime(): boolean {
  return isSea();
}
