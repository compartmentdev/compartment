import { buildUpdatedSelfHostedEnvironment, createRandomSecret } from './self-hosted-env';
import {
  readRequiredSelfHostedEnvironmentPort,
  readRequiredSelfHostedEnvironmentRawValue,
  readRequiredSelfHostedEnvironmentValue,
} from './self-hosted-env-file';
import { readCanonicalNodeAgentSocketPath, readCanonicalSystemApiSocketPath } from './self-hosted-host-socket-paths';
import type { SelfHostedRuntimeSelection, RenderedSelfHostedEnvironment } from './self-hosted-env.types';
import { readBundledEnvTemplate } from './runtime-assets';
import type { BundledAssets } from './runtime-assets.types';
import type { ManagedDomainInstallState } from './managed-domain.types';

interface RequiredUpdateEnvironmentValues {
  acmeEmail: string;
  artifactRegistryReadPassword: string;
  artifactRegistryReadUsername: string;
  artifactRegistryWritePassword: string;
  artifactRegistryWriteUsername: string;
  baseDomain: string;
  edgeToken: string;
  postgresPassword: string;
  publicHttpPort: number;
  publicHttpsPort: number;
  publicIngressIpv4: string;
  publicIngressIpv6: string;
  runtimeControlToken: string;
  sessionSecret: string;
  variablesMasterKey: string;
}

interface RegistryUpdateEnvironmentValues {
  artifactRegistryReadPassword: string;
  artifactRegistryReadUsername: string;
  artifactRegistryWritePassword: string;
  artifactRegistryWriteUsername: string;
}

interface SystemApiUpdateEnvironmentValues {
  nodeAgentSocketPath: string;
  systemApiSocketPath: string;
  systemToken: string;
}

export async function buildRenderedSelfHostedUpdateEnvironment(
  assetPaths: BundledAssets,
  environmentValues: Record<string, string>,
  dockerWorkDirectory: string,
  runtimeSelection: SelfHostedRuntimeSelection,
  managedDomain?: ManagedDomainInstallState,
): Promise<RenderedSelfHostedEnvironment> {
  const templateText: string = await readBundledEnvTemplate(assetPaths);
  return buildUpdatedSelfHostedEnvironment({
    ...readRequiredUpdateEnvironmentValues(environmentValues),
    currentValues: environmentValues,
    dockerWorkDirectory,
    ...(managedDomain === undefined ? {} : { managedDomain }),
    runtimeSelection,
    ...readSystemApiUpdateEnvironmentValues(environmentValues),
    templateText,
  });
}

function readRequiredUpdateEnvironmentValues(
  environmentValues: Record<string, string>,
): RequiredUpdateEnvironmentValues {
  return {
    acmeEmail: readRequiredSelfHostedEnvironmentRawValue(environmentValues, 'COMPARTMENT_ACME_EMAIL'),
    ...readRegistryUpdateEnvironmentValues(environmentValues),
    baseDomain: readRequiredSelfHostedEnvironmentValue(environmentValues, 'COMPARTMENT_BASE_DOMAIN'),
    edgeToken: readRequiredSelfHostedEnvironmentValue(environmentValues, 'COMPARTMENT_EDGE_TOKEN'),
    postgresPassword: readRequiredSelfHostedEnvironmentValue(environmentValues, 'COMPARTMENT_POSTGRES_PASSWORD'),
    publicHttpPort: readRequiredSelfHostedEnvironmentPort(environmentValues, 'COMPARTMENT_PUBLIC_HTTP_PORT'),
    publicHttpsPort: readRequiredSelfHostedEnvironmentPort(environmentValues, 'COMPARTMENT_PUBLIC_HTTPS_PORT'),
    publicIngressIpv4: readRequiredSelfHostedEnvironmentRawValue(environmentValues, 'COMPARTMENT_PUBLIC_INGRESS_IPV4'),
    publicIngressIpv6: readRequiredSelfHostedEnvironmentRawValue(environmentValues, 'COMPARTMENT_PUBLIC_INGRESS_IPV6'),
    runtimeControlToken: readRequiredSelfHostedEnvironmentValue(environmentValues, 'COMPARTMENT_RUNTIME_CONTROL_TOKEN'),
    sessionSecret: readRequiredSelfHostedEnvironmentValue(environmentValues, 'COMPARTMENT_SESSION_SECRET'),
    variablesMasterKey: readRequiredSelfHostedEnvironmentValue(environmentValues, 'COMPARTMENT_VARIABLES_MASTER_KEY'),
  };
}

function readRegistryUpdateEnvironmentValues(
  environmentValues: Record<string, string>,
): RegistryUpdateEnvironmentValues {
  return {
    artifactRegistryReadPassword: readExistingOrCreateSecret(
      environmentValues,
      'COMPARTMENT_ARTIFACT_REGISTRY_READ_PASSWORD',
    ),
    artifactRegistryReadUsername: readExistingOrDefault(
      environmentValues,
      'COMPARTMENT_ARTIFACT_REGISTRY_READ_USERNAME',
      'compartment-reader',
    ),
    artifactRegistryWritePassword: readExistingOrCreateSecret(
      environmentValues,
      'COMPARTMENT_ARTIFACT_REGISTRY_WRITE_PASSWORD',
    ),
    artifactRegistryWriteUsername: readExistingOrDefault(
      environmentValues,
      'COMPARTMENT_ARTIFACT_REGISTRY_WRITE_USERNAME',
      'compartment-writer',
    ),
  };
}

function readExistingOrCreateSecret(values: Record<string, string>, variableName: string): string {
  return readExistingOrDefault(values, variableName, createRandomSecret());
}

function readExistingOrDefault(values: Record<string, string>, variableName: string, defaultValue: string): string {
  const value: string | undefined = values[variableName];
  return value === undefined || value.trim() === '' ? defaultValue : value;
}

function readSystemApiUpdateEnvironmentValues(
  environmentValues: Record<string, string>,
): SystemApiUpdateEnvironmentValues {
  return {
    nodeAgentSocketPath: readCanonicalNodeAgentSocketPath(environmentValues),
    systemApiSocketPath: readCanonicalSystemApiSocketPath(environmentValues),
    systemToken: readRequiredSelfHostedEnvironmentValue(environmentValues, 'COMPARTMENT_SYSTEM_TOKEN'),
  };
}
