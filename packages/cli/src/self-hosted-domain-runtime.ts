import { ensureSelfHostedDockerExecutionContext } from './self-hosted-docker-context';
import {
  renderSelfHostedDomainEnvironment,
  renderSelfHostedManagedDomainEnvironment,
} from './self-hosted-domain-environment';
import { readSelfHostedImageRefsFromEnvironmentText } from './self-hosted-env';
import { writeSelfHostedPrivateFile } from './self-hosted-file-permissions';
import { buildSelfHostedPathSelection } from './self-hosted-install-paths';
import type { SelfHostedPathSelection } from './self-hosted-install-paths.types';
import { readRequiredSelfHostedInstall } from './self-hosted-install-read';
import type { ReadSelfHostedInstallResult } from './self-hosted-install-read.types';
import { restartSelfHostedRuntime } from './docker-runtime';
import type { DockerExecutionContext } from './docker-runtime.types';
import type { SystemDomainRuntimeApplyInput } from './system-domain.types';

export async function applySelfHostedSystemDomainRuntime(input: SystemDomainRuntimeApplyInput): Promise<void> {
  const paths: SelfHostedPathSelection = buildSelfHostedPathSelection();
  const install: ReadSelfHostedInstallResult = await readRequiredSelfHostedInstall(paths);
  const dockerContext: DockerExecutionContext = await ensureSelfHostedDockerExecutionContext(input.context);
  const nextEnvironmentText: string = renderSelfHostedRuntimeDomainEnvironment(install.environmentText, input);

  reportProgress(input, 'Staging domain runtime environment...');
  await writeSelfHostedPrivateFile(install.installPaths.stagedAssetPaths.envPath, nextEnvironmentText);
  reportProgress(input, 'Restarting self-hosted runtime for domain ingress...');
  await restartSelfHostedRuntime(dockerContext, {
    composePath: install.installPaths.stagedAssetPaths.composePath,
    envPath: install.installPaths.stagedAssetPaths.envPath,
    imageRefs: readSelfHostedImageRefsFromEnvironmentText(nextEnvironmentText),
    imageSource: install.state.imageSource,
    installDirectory: install.installPaths.configDir,
    localComposePath: install.installPaths.stagedAssetPaths.localComposePath,
  });
}

function renderSelfHostedRuntimeDomainEnvironment(
  environmentText: string,
  input: SystemDomainRuntimeApplyInput,
): string {
  if (input.managedDomain !== undefined) {
    return renderSelfHostedManagedDomainEnvironment(environmentText, input.managedDomain);
  }

  return renderSelfHostedDomainEnvironment(environmentText, input.hostPlan, input.certificate);
}

function reportProgress(input: SystemDomainRuntimeApplyInput, message: string): void {
  input.context?.reportProgress?.(message);
}
