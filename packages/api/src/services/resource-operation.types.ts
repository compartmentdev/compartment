export interface ResourceRuntimeEnvValue {
  keyName: string;
  value: string;
}

export interface ResourceOperationDefinition {
  command: string;
  env: ResourceRuntimeEnvValue[];
  image: string;
}

export interface ResourceOperationResult {
  stderr: string;
  stdout: string;
}
