export interface BuildEnvSnapshotValue {
  encryptionKeyId: string;
  valueCiphertext: string;
}

export type BuildEnvMap = Record<string, string>;

export interface BuildEnvResolutionOptions {
  ignoredDescriptorResourceOutputBindingKeyNames: readonly string[];
}

export interface BuildEnvResolutionTarget {
  environmentId: string | null;
  organizationId: string | null;
  serviceId: string | null;
  serviceName: string;
}
export type BuildEnvSnapshot = Record<string, BuildEnvSnapshotValue>;
