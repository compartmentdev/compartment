import { hasText } from './text';

interface SelfHostedGeneratedSecretEnvironment {
  readonly COMPARTMENT_ARTIFACT_REGISTRY_READ_PASSWORD?: string | undefined;
  readonly COMPARTMENT_ARTIFACT_REGISTRY_WRITE_PASSWORD?: string | undefined;
  readonly COMPARTMENT_DATABASE_URL?: string | undefined;
  readonly COMPARTMENT_EDGE_TOKEN?: string | undefined;
  readonly COMPARTMENT_ENV?: string | undefined;
  readonly COMPARTMENT_POSTGRES_PASSWORD?: string | undefined;
  readonly COMPARTMENT_RUNTIME_CONTROL_TOKEN?: string | undefined;
  readonly COMPARTMENT_SESSION_SECRET?: string | undefined;
  readonly COMPARTMENT_SYSTEM_TOKEN?: string | undefined;
  readonly COMPARTMENT_VARIABLES_MASTER_KEY?: string | undefined;
}

interface SelfHostedGeneratedSecretEnvironmentValidationOptions {
  readonly requireArtifactRegistrySecrets?: boolean | undefined;
}

type GeneratedSecretVariableName =
  | 'COMPARTMENT_ARTIFACT_REGISTRY_READ_PASSWORD'
  | 'COMPARTMENT_ARTIFACT_REGISTRY_WRITE_PASSWORD'
  | 'COMPARTMENT_EDGE_TOKEN'
  | 'COMPARTMENT_POSTGRES_PASSWORD'
  | 'COMPARTMENT_RUNTIME_CONTROL_TOKEN'
  | 'COMPARTMENT_SYSTEM_TOKEN';

const generatedSecretVariableNames: readonly GeneratedSecretVariableName[] = [
  'COMPARTMENT_ARTIFACT_REGISTRY_READ_PASSWORD',
  'COMPARTMENT_ARTIFACT_REGISTRY_WRITE_PASSWORD',
  'COMPARTMENT_EDGE_TOKEN',
  'COMPARTMENT_POSTGRES_PASSWORD',
  'COMPARTMENT_RUNTIME_CONTROL_TOKEN',
  'COMPARTMENT_SYSTEM_TOKEN',
];
const artifactRegistryGeneratedSecretVariableNames: ReadonlySet<GeneratedSecretVariableName> = new Set([
  'COMPARTMENT_ARTIFACT_REGISTRY_READ_PASSWORD',
  'COMPARTMENT_ARTIFACT_REGISTRY_WRITE_PASSWORD',
]);
const generatedSecretHexPattern: RegExp = /^[0-9a-fA-F]{48,}$/u;
const generatedSecret64HexPattern: RegExp = /^[0-9a-fA-F]{64}$/u;

export function assertSelfHostedGeneratedSecretEnvironment(
  env: SelfHostedGeneratedSecretEnvironment,
  options: SelfHostedGeneratedSecretEnvironmentValidationOptions = {},
): void {
  if (env.COMPARTMENT_ENV !== 'self-hosted') {
    return;
  }

  for (const variableName of generatedSecretVariableNames) {
    assertGeneratedSecretValue(env[variableName], variableName, options);
  }

  assertGenerated64HexSecretValue(env.COMPARTMENT_SESSION_SECRET, 'COMPARTMENT_SESSION_SECRET');
  assertGeneratedVariablesMasterKey(env.COMPARTMENT_VARIABLES_MASTER_KEY);
  assertDatabaseUrlPassword(env);
}

function assertGeneratedSecretValue(
  value: string | undefined,
  variableName: GeneratedSecretVariableName,
  options: SelfHostedGeneratedSecretEnvironmentValidationOptions,
): void {
  if (value === undefined && canOmitGeneratedSecretValue(variableName, options)) {
    return;
  }
  if (!hasText(value)) {
    throw new Error(`The self-hosted environment is missing ${variableName}.`);
  }
  if (!generatedSecretHexPattern.test(value)) {
    throw new Error(`${variableName} must be at least 48 hex characters for self-hosted environments.`);
  }
}

function canOmitGeneratedSecretValue(
  variableName: GeneratedSecretVariableName,
  options: SelfHostedGeneratedSecretEnvironmentValidationOptions,
): boolean {
  return (
    options.requireArtifactRegistrySecrets === false && artifactRegistryGeneratedSecretVariableNames.has(variableName)
  );
}

function assertGeneratedVariablesMasterKey(value: string | undefined): void {
  const masterKey: string = assertGenerated64HexSecretValue(value, 'COMPARTMENT_VARIABLES_MASTER_KEY');
  if (hasOneRepeatedCharacter(masterKey)) {
    throw new Error(
      'COMPARTMENT_VARIABLES_MASTER_KEY must not use one repeated hex character for self-hosted environments.',
    );
  }
}

function assertGenerated64HexSecretValue(value: string | undefined, variableName: string): string {
  if (!hasText(value)) {
    throw new Error(`The self-hosted environment is missing ${variableName}.`);
  }
  if (!generatedSecret64HexPattern.test(value)) {
    throw new Error(`${variableName} must be exactly 64 hex characters for self-hosted environments.`);
  }

  return value;
}

function hasOneRepeatedCharacter(value: string): boolean {
  const firstCharacter: string = value.charAt(0);
  return firstCharacter !== '' && value.split('').every((character: string): boolean => character === firstCharacter);
}

function assertDatabaseUrlPassword(env: SelfHostedGeneratedSecretEnvironment): void {
  const databaseUrl: string = readRequiredSelfHostedValue(env.COMPARTMENT_DATABASE_URL, 'COMPARTMENT_DATABASE_URL');
  const postgresPassword: string = readRequiredSelfHostedValue(
    env.COMPARTMENT_POSTGRES_PASSWORD,
    'COMPARTMENT_POSTGRES_PASSWORD',
  );

  if (readDatabaseUrlPassword(databaseUrl) !== postgresPassword) {
    throw new Error(
      'COMPARTMENT_DATABASE_URL must include the same password as COMPARTMENT_POSTGRES_PASSWORD for self-hosted environments.',
    );
  }
}

function readRequiredSelfHostedValue(value: string | undefined, variableName: string): string {
  if (hasText(value)) {
    return value;
  }

  throw new Error(`The self-hosted environment is missing ${variableName}.`);
}

function readDatabaseUrlPassword(value: string): string {
  try {
    return decodeURIComponent(new URL(value).password);
  } catch {
    throw new Error('COMPARTMENT_DATABASE_URL must be a valid URL for self-hosted environments.');
  }
}
