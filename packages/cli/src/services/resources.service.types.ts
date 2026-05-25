export interface ResourceScopeInput {
  cwd: string;
  environmentName?: string | undefined;
  projectName?: string | undefined;
}

export interface ResourceTargetInput extends ResourceScopeInput {
  resourceName: string;
}

export interface ResourceOutputInput extends ResourceTargetInput {
  outputName: string;
  reveal?: boolean | undefined;
}

export interface ResourceLogsInput extends ResourceTargetInput {
  since?: string | undefined;
  tailLines?: number | undefined;
}

export interface ResourceDeleteInput extends ResourceTargetInput {
  deleteData?: boolean | undefined;
}

export interface ResourceBackupShowInput extends ResourceScopeInput {
  backupId: string;
}

export interface ResourceRestoreBaseInput extends ResourceScopeInput {
  backupId: string;
  confirmed?: boolean | undefined;
}

export interface ResourceRestoreExistingInput extends ResourceRestoreBaseInput {
  resourceName: string;
  targetResourceName?: undefined;
}

export interface ResourceRestoreAsInput extends ResourceRestoreBaseInput {
  resourceName?: undefined;
  targetResourceName: string;
}

export type ResourceRestoreInput = ResourceRestoreAsInput | ResourceRestoreExistingInput;
