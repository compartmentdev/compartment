export interface PreparedSourcePaths {
  buildContextDirectory: string;
  serviceDirectory: string;
  serviceRelativePath: string;
}

export interface PrepareSourcePathsInput {
  extractionDirectory: string;
  includePaths: readonly string[];
  servicePath: string;
}
