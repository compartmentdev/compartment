import type { AppRouteAccessMode } from './access.contract';
import type { CompartmentDescriptorRelatedFile } from './compartment-descriptor-guide.contract';
import type {
  CompartmentServiceBuildConfig,
  CompartmentServiceBuildStrategy,
  ResolvedCompartmentServiceBuildConfig,
} from './service-build.contract';
import type { CompartmentServiceKind } from './compartment-service-kind.contract';
import type {
  CompartmentServiceReadinessConfig,
  ResolvedOptionalServiceReadinessConfig,
  CompartmentServiceReadinessType,
} from './service-readiness.contract';
import type {
  CompartmentServiceReleaseConfig,
  ResolvedOptionalCompartmentServiceReleaseConfig,
} from './service-release.contract';
import type { CompartmentServiceRunConfig, ResolvedCompartmentServiceRunConfig } from './service-run.contract';

export type CompartmentResourceEnv = Record<string, string>;

export interface CompartmentResourceOperationConfig {
  command: string;
  env?: CompartmentResourceEnv | undefined;
  image?: string | undefined;
  schedule?: CompartmentResourceOperationScheduleConfig | undefined;
}

export interface CompartmentResourceOperationsConfig {
  backup?: CompartmentResourceOperationConfig | undefined;
  restore?: CompartmentResourceOperationConfig | undefined;
}

export type CompartmentResourceOperationScheduleInterval = 'daily' | 'hourly';

export interface CompartmentResourceOperationRetentionConfig {
  includeManual?: boolean | undefined;
  keepLast?: number | undefined;
  maxAgeDays?: number | undefined;
}

export interface CompartmentResourceOperationScheduleConfig {
  cron?: string | undefined;
  interval?: CompartmentResourceOperationScheduleInterval | undefined;
  retention?: CompartmentResourceOperationRetentionConfig | undefined;
}

export interface CompartmentResourceVolumeMountConfig {
  mountPath: string;
}

export type CompartmentResourceVolumeValue = string | CompartmentResourceVolumeMountConfig;
export type CompartmentResourceVolumes = Record<string, CompartmentResourceVolumeValue>;

export interface CompartmentResourceReadinessConfig {
  port: number;
  timeoutMs?: number | undefined;
  type: 'tcp';
}

export interface CompartmentResourceOutputConfig {
  sensitive: boolean;
  value: string;
}

export type CompartmentResourceOutputs = Record<string, CompartmentResourceOutputConfig>;
export type CompartmentResourcePreset = 'postgres';
export type CompartmentResourceGeneratedVariableEncoding = 'base64url' | 'hex';
export type CompartmentResourceGeneratedVariableGenerator = 'token';

export interface CompartmentResourceGeneratedVariableConfig {
  bytes?: number | undefined;
  encoding?: CompartmentResourceGeneratedVariableEncoding | undefined;
  generator: CompartmentResourceGeneratedVariableGenerator;
}

export type CompartmentResourceGeneratedVariables = Record<string, CompartmentResourceGeneratedVariableConfig>;

export interface ResolvedCompartmentResourceReadinessConfig {
  port: number;
  timeoutMs: number;
  type: 'tcp';
}

export type ResolvedOptionalCompartmentResourceReadinessConfig = ResolvedCompartmentResourceReadinessConfig | null;

export interface CompartmentAuthoredResourceConfig {
  command?: string[] | undefined;
  env?: CompartmentResourceEnv | undefined;
  generatedVariables?: CompartmentResourceGeneratedVariables | undefined;
  image: string;
  operations?: CompartmentResourceOperationsConfig | undefined;
  outputs?: CompartmentResourceOutputs | undefined;
  ports?: number[] | undefined;
  preset?: CompartmentResourcePreset | undefined;
  readiness?: CompartmentResourceReadinessConfig | undefined;
  volumes?: CompartmentResourceVolumes | undefined;
}

export interface CompartmentAuthoredResourceFullConfigInput extends CompartmentAuthoredResourceConfig {
  preset?: undefined;
}

export interface CompartmentAuthoredResourcePresetConfigInput {
  env?: CompartmentResourceEnv | undefined;
  preset: CompartmentResourcePreset;
}

export type CompartmentAuthoredResourceConfigInput =
  | CompartmentAuthoredResourceFullConfigInput
  | CompartmentAuthoredResourcePresetConfigInput;

export type CompartmentAuthoredResources = Record<string, CompartmentAuthoredResourceConfig>;
export type CompartmentAuthoredResourcesInput = Record<string, CompartmentAuthoredResourceConfigInput>;

export type CompartmentServiceConnectionEnv = Record<string, string>;

export interface CompartmentServiceConnectionConfig {
  env: CompartmentServiceConnectionEnv;
}

export type CompartmentServiceConnections = Record<string, CompartmentServiceConnectionConfig>;

export interface CompartmentAuthoredServiceConfig {
  accessMode?: AppRouteAccessMode | undefined;
  build?: CompartmentServiceBuildConfig | undefined;
  connections?: CompartmentServiceConnections | undefined;
  kind?: CompartmentServiceKind | undefined;
  path: string;
  readiness?: CompartmentServiceReadinessConfig | undefined;
  release?: CompartmentServiceReleaseConfig | undefined;
  run?: CompartmentServiceRunConfig | undefined;
}

export type CompartmentAuthoredService = string | CompartmentAuthoredServiceConfig;
export type CompartmentAuthoredServices = Record<string, CompartmentAuthoredService>;

export interface CompartmentAuthoredDescriptor {
  name: string;
  resources?: CompartmentAuthoredResources | undefined;
  services: CompartmentAuthoredServices;
}

export interface CompartmentAuthoredDescriptorInput {
  name: string;
  resources?: CompartmentAuthoredResourcesInput | undefined;
  services: CompartmentAuthoredServices;
}

export interface CompartmentInitResult {
  descriptor: CompartmentAuthoredDescriptor;
  file: string;
}

export interface CompartmentInitResultInput {
  descriptor: CompartmentAuthoredDescriptorInput;
  file: string;
}

export type CompartmentDescriptorServiceValueForm = 'string_path' | 'service_config';

export interface CompartmentDescriptorSchemaDefaults {
  readiness: ResolvedOptionalServiceReadinessConfig;
  serviceRelease: ResolvedOptionalCompartmentServiceReleaseConfig;
  resourceReadiness: ResolvedOptionalCompartmentResourceReadinessConfig;
  serviceBuild: ResolvedCompartmentServiceBuildConfig;
  serviceKind: CompartmentServiceKind;
  serviceRun: ResolvedCompartmentServiceRunConfig;
}

export interface CompartmentDescriptorSchemaRules {
  buildFields: string[];
  buildOutputDirectoryAllowedKinds: CompartmentServiceKind[];
  buildOutputDirectoryPathRule: string;
  buildOutputDirectoryRequiredKinds: CompartmentServiceKind[];
  dockerfileIgnoredKinds: CompartmentServiceKind[];
  buildStrategyForbiddenKinds: CompartmentServiceKind[];
  buildStrategies: CompartmentServiceBuildStrategy[];
  projectNamePattern: string;
  projectReservedNames: string[];
  readinessFields: string[];
  readinessForbiddenKinds: CompartmentServiceKind[];
  readinessTypes: CompartmentServiceReadinessType[];
  releaseFields: string[];
  releaseForbiddenKinds: CompartmentServiceKind[];
  resourceConfigFields: string[];
  resourceConfigRequiredFieldSets: string[][];
  resourceGeneratedVariableEncodings: CompartmentResourceGeneratedVariableEncoding[];
  resourceGeneratedVariableFields: string[];
  resourceGeneratedVariableGenerators: CompartmentResourceGeneratedVariableGenerator[];
  resourceOperationFields: string[];
  resourceOperationRetentionFields: string[];
  resourceOperationScheduleFields: string[];
  resourceOperationScheduleIntervals: CompartmentResourceOperationScheduleInterval[];
  resourceOutputFields: string[];
  resourceOutputNamePattern: string;
  resourcePresetRules: Record<CompartmentResourcePreset, CompartmentResourcePresetSchemaRule>;
  resourcePresets: CompartmentResourcePreset[];
  resourceReadinessFields: string[];
  resourceReadinessTypes: 'tcp'[];
  resourceValueForms: 'resource_config'[];
  runFields: string[];
  runForbiddenKinds: CompartmentServiceKind[];
  serviceConfigFields: string[];
  serviceConfigRequiredFields: string[];
  serviceConnectionEnvKeyPattern: string;
  serviceConnectionEnvKeyReservedPrefixRule: string;
  serviceConnectionOutputNamePattern: string;
  serviceConnectionShape: string;
  serviceConnectionValidationRules: string[];
  serviceKinds: CompartmentServiceKind[];
  serviceNamePattern: string;
  serviceObjectOnlyKinds: CompartmentServiceKind[];
  serviceValueForms: CompartmentDescriptorServiceValueForm[];
  servicesMustNotBeEmpty: boolean;
}

export interface CompartmentResourcePresetSchemaRule {
  overrideFields: string[];
}

export interface CompartmentDescriptorSchemaResponse {
  defaults: CompartmentDescriptorSchemaDefaults;
  doesNotOwn: string[];
  expandedExampleYaml: string;
  fileName: string;
  location: string;
  minimalExampleYaml: string;
  owns: string[];
  relatedFiles: CompartmentDescriptorRelatedFile[];
  rules: CompartmentDescriptorSchemaRules;
}
