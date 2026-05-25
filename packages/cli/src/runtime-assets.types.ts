export interface FileBundledAsset {
  kind: 'file';
  path: string;
}

export interface InlineBundledAsset {
  kind: 'inline';
  text: string;
}

export type BundledRuntimeAsset = FileBundledAsset | InlineBundledAsset;

export interface BundledAssets {
  compose: BundledRuntimeAsset;
  envTemplate: BundledRuntimeAsset;
  localCompose: BundledRuntimeAsset;
}

export interface StagedAssetPaths {
  configDir: string;
  composePath: string;
  dataDir: string;
  dockerWorkDirectory: string;
  envPath: string;
  localComposePath: string;
}
