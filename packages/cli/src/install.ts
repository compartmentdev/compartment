import { ensureSelfHostedDockerExecutionContext } from './self-hosted-docker-context';
import { buildPublishedSelfHostedRuntimeSelection } from './self-hosted-env';
import { writeSelfHostedInstallState } from './self-hosted-install-state';
import { assertSelfHostedSystemPrivileges } from './self-hosted-system-privileges';
import { buildSelfHostedPathSelection } from './self-hosted-install-paths';
import { assertInstallPublicPortsAvailable } from './install-public-port-preflight';
import { prepareSelfHostedRuntimeImages, startSelfHostedRuntime } from './docker-runtime';
import {
  assertNodeAgentHostServiceInstallable,
  restartNodeAgentHostService,
  stageNodeAgentHostService,
} from './node-agent-service';
import {
  assertInstallDirectoryAvailable,
  prepareInstallEnvironment,
  readApiUrl,
  readInstallPackageDirectory,
  stagePreparedInstallEnvironment,
} from './install-environment';
import type {
  InstallContext,
  InstallProgressReporter,
  InstallImageSource,
  SelfHostedInstallInput,
  SelfHostedInstallPreflightInput,
  SelfHostedInstallResult,
  PreparedInstallEnvironment,
} from './install.types';
import { readCompartmentDevApiUrl } from './repo-root';
import { install } from './services/install.service';
import type { InstallInput } from './services/install.service.types';
import type { DockerExecutionContext, StartSelfHostedRuntimeInput } from './docker-runtime.types';
import type { SelfHostedPathSelection } from './self-hosted-install-paths.types';
import type { ManagedDomainInstallState, SelfHostedInstallState } from './self-hosted-install-state.types';
import type { SelfHostedRuntimeImageRegistry } from './self-hosted-env.types';
import type { StagedAssetPaths } from './runtime-assets.types';
import { buildStagedAssetPaths, readBundledAssets, readBundledEnvTemplate } from './runtime-assets';

export async function installSelfHosted(input: SelfHostedInstallInput): Promise<SelfHostedInstallResult> {
  const paths: SelfHostedPathSelection = buildSelfHostedPathSelection();
  assertNodeAgentHostServiceInstallable();
  assertSelfHostedSystemPrivileges();
  reportInstallProgress(input.context, 'Preparing self-hosted install environment...');
  const preparedEnvironment: PreparedInstallEnvironment = await prepareInstallEnvironment(input, paths);
  const dockerContext: DockerExecutionContext = await ensureSelfHostedDockerExecutionContext(input.context);

  await startInstallRuntime(dockerContext, preparedEnvironment, input);
  const result: SelfHostedInstallResult = await installPreparedSelfHostedEnvironment(input, preparedEnvironment);
  await writeFreshSelfHostedInstallState(
    preparedEnvironment.paths,
    input.options.imageRegistry,
    input.options.imageSource,
    input.options.installationId,
    input.options.managedDomain,
  );
  return result;
}

export async function preflightSelfHostedInstall(input: SelfHostedInstallPreflightInput): Promise<void> {
  const paths: SelfHostedPathSelection = buildSelfHostedPathSelection();
  assertNodeAgentHostServiceInstallable();
  assertSelfHostedSystemPrivileges();
  const stagedAssetPaths: StagedAssetPaths = buildStagedAssetPaths(paths.configDir, paths.dataDir);
  const packageDirectory: string = readInstallPackageDirectory(input.context);

  assertInstallDirectoryAvailable(stagedAssetPaths);
  buildPublishedSelfHostedRuntimeSelection(input.options.version, input.options.imageRegistry);
  const dockerContext: DockerExecutionContext = await ensureSelfHostedDockerExecutionContext(input.context);
  await assertInstallPublicPortsAvailable({
    dockerContext,
    publicHttpPort: input.options.publicHttpPort,
    publicHttpsPort: input.options.publicHttpsPort,
  });
  await readBundledEnvTemplate(readBundledAssets(packageDirectory));
}

export async function installDev(input: Omit<InstallInput, 'baseDomain'>): Promise<SelfHostedInstallResult> {
  const apiUrl: string = await readCompartmentDevApiUrl();
  const response: SelfHostedInstallResult = await installAgainstApi(input, apiUrl, 'localhost', {
    configDir: process.cwd(),
    dataDir: process.cwd(),
  });

  return response;
}

async function installPreparedSelfHostedEnvironment(
  input: SelfHostedInstallInput,
  preparedEnvironment: PreparedInstallEnvironment,
): Promise<SelfHostedInstallResult> {
  reportInstallProgress(input.context, 'Installing compartment...');

  return await installAgainstApi(
    {
      adminEmail: input.options.adminEmail,
      adminPassword: input.options.adminPassword,
      organizationName: input.options.organizationName,
      organizationSlug: input.options.organizationSlug,
    },
    readApiUrl(preparedEnvironment.renderedEnvironment),
    preparedEnvironment.baseDomain,
    preparedEnvironment.paths,
  );
}

async function startInstallRuntime(
  dockerContext: DockerExecutionContext,
  preparedEnvironment: PreparedInstallEnvironment,
  input: SelfHostedInstallInput,
): Promise<void> {
  reportInstallProgress(input.context, 'Preparing runtime images...');
  await prepareInstallRuntimeImages(dockerContext, preparedEnvironment, input);
  reportInstallProgress(input.context, 'Staging self-hosted runtime assets...');
  await stagePreparedInstallEnvironment(preparedEnvironment);
  reportInstallProgress(input.context, 'Staging node agent service...');
  await stageNodeAgentHostService({
    envPath: preparedEnvironment.stagedAssetPaths.envPath,
  });
  reportInstallProgress(input.context, 'Starting self-hosted runtime...');
  await startInstallComposeRuntime(dockerContext, preparedEnvironment, input);
  reportInstallProgress(input.context, 'Restarting node agent service...');
  await restartNodeAgentHostService({
    envPath: preparedEnvironment.stagedAssetPaths.envPath,
  });
}

async function prepareInstallRuntimeImages(
  dockerContext: DockerExecutionContext,
  preparedEnvironment: PreparedInstallEnvironment,
  input: SelfHostedInstallInput,
): Promise<void> {
  const runtimeInput: StartSelfHostedRuntimeInput = buildInstallRuntimeInput(preparedEnvironment, input);
  await prepareSelfHostedRuntimeImages(dockerContext, runtimeInput);
}

async function startInstallComposeRuntime(
  dockerContext: DockerExecutionContext,
  preparedEnvironment: PreparedInstallEnvironment,
  input: SelfHostedInstallInput,
): Promise<void> {
  const runtimeInput: StartSelfHostedRuntimeInput = buildInstallRuntimeInput(preparedEnvironment, input);
  await startSelfHostedRuntime(dockerContext, runtimeInput);
}

function buildInstallRuntimeInput(
  preparedEnvironment: PreparedInstallEnvironment,
  input: SelfHostedInstallInput,
): StartSelfHostedRuntimeInput {
  return {
    composePath: preparedEnvironment.stagedAssetPaths.composePath,
    envPath: preparedEnvironment.stagedAssetPaths.envPath,
    imageRefs: preparedEnvironment.runtimeSelection.imageRefs,
    imageSource: input.options.imageSource,
    installDirectory: preparedEnvironment.stagedAssetPaths.configDir,
    localComposePath: preparedEnvironment.stagedAssetPaths.localComposePath,
    reportProgress: input.context?.reportProgress,
    skipRequiredImageVerificationBeforeStart: true,
  };
}

async function installAgainstApi(
  input: Omit<InstallInput, 'baseDomain'>,
  apiUrl: string,
  baseDomain: string,
  paths: SelfHostedPathSelection,
): Promise<SelfHostedInstallResult> {
  const response: Omit<SelfHostedInstallResult, 'apiUrl' | 'configDir' | 'dataDir'> = await install(
    { apiUrl },
    {
      ...input,
      baseDomain,
    },
  );

  return {
    ...response,
    apiUrl,
    configDir: paths.configDir,
    dataDir: paths.dataDir,
  };
}

async function writeFreshSelfHostedInstallState(
  paths: SelfHostedPathSelection,
  imageRegistry: SelfHostedRuntimeImageRegistry,
  imageSource: InstallImageSource,
  installationId: string,
  managedDomain: ManagedDomainInstallState | undefined,
): Promise<void> {
  const state: SelfHostedInstallState = {
    imageRegistry,
    imageSource,
    installationId,
    ...(managedDomain === undefined ? {} : { managedDomain }),
    stateVersion: 1,
  };

  await writeSelfHostedInstallState(paths, state);
}

function reportInstallProgress(context: InstallContext | undefined, message: string): void {
  const reportProgress: InstallProgressReporter | undefined = context?.reportProgress;
  reportProgress?.(message);
}
