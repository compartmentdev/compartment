import { existsSync } from 'node:fs';
import {
  buildSelfHostedEnvironment,
  buildPublishedSelfHostedRuntimeSelection,
  createRandomSecret,
  defaultNodeAgentSocketPath,
  defaultSystemApiSocketPath,
} from './self-hosted-env';
import { writeSelfHostedPrivateFile } from './self-hosted-file-permissions';
import {
  buildStagedAssetPathCandidates,
  buildStagedAssetPaths,
  readBundledAssets,
  readBundledEnvTemplate,
  stageBundledAssets,
} from './runtime-assets';
import { readRequiredRenderedEnvironmentValue } from './rendered-environment';
import type {
  InstallContext,
  SelfHostedInstallInput,
  PreparedInstallEnvironment,
  PreparedInstallEnvironmentOptions,
} from './install.types';
import type { SelfHostedPathSelection } from './self-hosted-install-paths.types';
import type {
  BuildSelfHostedEnvironmentInput,
  SelfHostedRuntimeSelection,
  RenderedSelfHostedEnvironment,
} from './self-hosted-env.types';
import type {
  BuildRenderedInstallEnvironmentInput,
  InstallSecretEnvironment,
  InstallSystemApiEnvironment,
  RenderPreparedInstallEnvironmentInput,
  RenderInstallEnvironmentInput,
} from './install-environment.types';
import type { BundledAssets, StagedAssetPaths } from './runtime-assets.types';

export async function prepareInstallEnvironment(
  input: SelfHostedInstallInput,
  paths: SelfHostedPathSelection,
): Promise<PreparedInstallEnvironment> {
  const stagedAssetPaths: StagedAssetPaths = buildStagedAssetPaths(paths.configDir, paths.dataDir);
  assertInstallDirectoryAvailable(stagedAssetPaths);
  const packageDirectory: string = readInstallPackageDirectory(input.context);
  const preparedEnvironment: PreparedInstallEnvironment = await buildPreparedInstallEnvironment(
    input,
    paths,
    stagedAssetPaths,
    packageDirectory,
  );

  return preparedEnvironment;
}

export async function stagePreparedInstallEnvironment(preparedEnvironment: PreparedInstallEnvironment): Promise<void> {
  await stageBundledAssets(preparedEnvironment.stagedAssetPaths, preparedEnvironment.assetPaths);
  await writeSelfHostedPrivateFile(
    preparedEnvironment.stagedAssetPaths.envPath,
    preparedEnvironment.renderedEnvironment.text,
  );
}

export function readApiUrl(renderedEnvironment: RenderedSelfHostedEnvironment): string {
  return readRequiredRenderedEnvironmentValue(renderedEnvironment, 'COMPARTMENT_API_URL');
}

export function readInstallPackageDirectory(context: InstallContext | undefined): string {
  return context?.packageDirectory ?? __dirname;
}

async function buildPreparedInstallEnvironment(
  input: SelfHostedInstallInput,
  paths: SelfHostedPathSelection,
  stagedAssetPaths: StagedAssetPaths,
  packageDirectory: string,
): Promise<PreparedInstallEnvironment> {
  const { baseDomain, runtimeSelection }: PreparedInstallEnvironmentOptions =
    readPreparedInstallEnvironmentOptions(input);
  const assetPaths: BundledAssets = readBundledAssets(packageDirectory);
  const renderedEnvironment: RenderedSelfHostedEnvironment = await renderPreparedInstallEnvironment(
    input,
    stagedAssetPaths,
    assetPaths,
    baseDomain,
    runtimeSelection,
  );
  return createPreparedInstallEnvironmentResult(
    paths,
    stagedAssetPaths,
    assetPaths,
    baseDomain,
    runtimeSelection,
    renderedEnvironment,
  );
}

async function renderPreparedInstallEnvironment(
  input: SelfHostedInstallInput,
  stagedAssetPaths: StagedAssetPaths,
  assetPaths: BundledAssets,
  baseDomain: string,
  runtimeSelection: SelfHostedRuntimeSelection,
): Promise<RenderedSelfHostedEnvironment> {
  return await renderInstallEnvironment({
    acmeEmail: input.options.adminEmail,
    assetPaths,
    baseDomain,
    managedDomain: input.options.managedDomain,
    publicHttpPort: input.options.publicHttpPort,
    publicHttpsPort: input.options.publicHttpsPort,
    publicIngressIpv4: input.options.publicIngressIpv4,
    publicIngressIpv6: input.options.publicIngressIpv6,
    runtimeSelection,
    stagedAssetPaths,
  });
}

export function assertInstallDirectoryAvailable(stagedAssetPaths: StagedAssetPaths): void {
  const existingEnvironmentPath: string | undefined = readExistingSelfHostedEnvironmentPath(stagedAssetPaths);
  if (existingEnvironmentPath === undefined) {
    return;
  }

  throw new Error(
    `Refusing to re-run install for an existing self-hosted config directory at ${stagedAssetPaths.configDir} because ${existingEnvironmentPath} already exists. Remove the existing installation explicitly before retrying.`,
  );
}

function readExistingSelfHostedEnvironmentPath(stagedAssetPaths: StagedAssetPaths): string | undefined {
  return buildStagedAssetPathCandidates(stagedAssetPaths.configDir, stagedAssetPaths.dataDir).find(
    (candidatePaths: StagedAssetPaths): boolean => existsSync(candidatePaths.envPath),
  )?.envPath;
}

function createPreparedInstallEnvironmentResult(
  paths: SelfHostedPathSelection,
  stagedAssetPaths: StagedAssetPaths,
  assetPaths: BundledAssets,
  baseDomain: string,
  runtimeSelection: SelfHostedRuntimeSelection,
  renderedEnvironment: RenderedSelfHostedEnvironment,
): PreparedInstallEnvironment {
  return {
    assetPaths,
    baseDomain,
    paths,
    renderedEnvironment,
    runtimeSelection,
    stagedAssetPaths,
  };
}

function readPreparedInstallEnvironmentOptions(input: SelfHostedInstallInput): PreparedInstallEnvironmentOptions {
  return {
    baseDomain: input.options.baseDomain,
    runtimeSelection: buildPublishedSelfHostedRuntimeSelection(input.options.version),
  };
}

async function renderInstallEnvironment(
  input: RenderPreparedInstallEnvironmentInput,
): Promise<RenderedSelfHostedEnvironment> {
  return await buildRenderedInstallEnvironment(buildRenderedInstallEnvironmentInput(input));
}

function buildRenderedInstallEnvironmentInput(
  input: RenderPreparedInstallEnvironmentInput,
): BuildRenderedInstallEnvironmentInput {
  return {
    acmeEmail: input.acmeEmail,
    assetPaths: input.assetPaths,
    baseDomain: input.baseDomain,
    dockerWorkDirectory: input.stagedAssetPaths.dockerWorkDirectory,
    managedDomain: input.managedDomain,
    publicHttpPort: input.publicHttpPort,
    publicHttpsPort: input.publicHttpsPort,
    publicIngressIpv4: input.publicIngressIpv4,
    publicIngressIpv6: input.publicIngressIpv6,
    runtimeSelection: input.runtimeSelection,
  };
}

async function buildRenderedInstallEnvironment(
  input: BuildRenderedInstallEnvironmentInput,
): Promise<RenderedSelfHostedEnvironment> {
  const templateText: string = await readBundledEnvTemplate(input.assetPaths);

  return buildSelfHostedEnvironment(
    buildSelfHostedEnvironmentInput(createRenderInstallEnvironmentInput(input, templateText)),
  );
}

function buildSelfHostedEnvironmentInput(input: RenderInstallEnvironmentInput): BuildSelfHostedEnvironmentInput {
  return {
    ...input,
    edgeToken: createRandomSecret(),
    postgresPassword: createRandomSecret(),
    ...buildInstallSecretEnvironment(),
    ...buildInstallSystemApiEnvironment(),
  };
}

function createRenderInstallEnvironmentInput(
  input: BuildRenderedInstallEnvironmentInput,
  templateText: string,
): RenderInstallEnvironmentInput {
  return {
    acmeEmail: input.acmeEmail,
    baseDomain: input.baseDomain,
    dockerWorkDirectory: input.dockerWorkDirectory,
    managedDomain: input.managedDomain,
    publicHttpPort: input.publicHttpPort,
    publicHttpsPort: input.publicHttpsPort,
    publicIngressIpv4: input.publicIngressIpv4,
    publicIngressIpv6: input.publicIngressIpv6,
    runtimeSelection: input.runtimeSelection,
    templateText,
  };
}

function buildInstallSecretEnvironment(): InstallSecretEnvironment {
  return {
    artifactRegistryReadPassword: createRandomSecret(),
    artifactRegistryReadUsername: 'compartment-reader',
    artifactRegistryWritePassword: createRandomSecret(),
    artifactRegistryWriteUsername: 'compartment-writer',
    runtimeControlToken: createRandomSecret(),
    sessionSecret: createRandomSecret(32),
    variablesMasterKey: createRandomSecret(32),
  };
}

function buildInstallSystemApiEnvironment(): InstallSystemApiEnvironment {
  return {
    nodeAgentSocketPath: defaultNodeAgentSocketPath,
    systemApiSocketPath: defaultSystemApiSocketPath,
    systemToken: createRandomSecret(),
  };
}
