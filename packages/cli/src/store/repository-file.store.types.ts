export interface RepositoryTextFileTargetInput {
  filePath: string;
  label: string;
  repositoryRoot: string;
}

export interface RepositoryTextFileWriteInput extends RepositoryTextFileTargetInput {
  contents: string;
}

export interface RepositoryTextFileUpdateInput extends RepositoryTextFileTargetInput {
  update: RepositoryTextFileUpdate;
}

export type RepositoryTextFileUpdate = (currentContents: string) => string | undefined;
