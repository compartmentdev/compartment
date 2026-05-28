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
import {
  assertNodeAgentRuntimeNetworkReconcileEnvironment,
  reconcileNodeAgentRuntimeNetworks,
} from './node-agent-runtime-network';
import { restartNodeAgentHostService } from './node-agent-service';
import { restartSelfHostedRuntime } from './docker-runtime';
import type { DockerExecutionContext } from './docker-runtime.types';
import type { SystemDomainRuntimeApplyInput } from './system-domain.types';

export async function applySelfHostedSystemDomainRuntime(input: SystemDomainRuntimeApplyInput): Promise<void> {
  const paths: SelfHostedPathSelection = buildSelfHostedPathSelection();
  const install: ReadSelfHostedInstallResult = await readRequiredSelfHostedInstall(paths);
  const nextEnvironmentText: string = renderSelfHostedRuntimeDomainEnvironment(install.environmentText, input);
  assertNodeAgentRuntimeNetworkReconcileEnvironment(nextEnvironmentText);
  const dockerContext: DockerExecutionContext = await ensureSelfHostedDockerExecutionContext(input.context);

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
  await reconcileDomainRuntimeNetworks(input, install, nextEnvironmentText);
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

async function reconcileDomainRuntimeNetworks(
  input: SystemDomainRuntimeApplyInput,
  install: ReadSelfHostedInstallResult,
  environmentText: string,
): Promise<void> {
  reportProgress(input, 'Reconciling runtime network attachments...');
  try {
    await reconcileNodeAgentRuntimeNetworks({ environmentText });
  } catch (error) {
    try {
      await retryDomainRuntimeNetworkReconcile(input, install, environmentText);
    } catch (retryError) {
      throw new AggregateError(
        [error, retryError],
        'Runtime network reconciliation failed before and after restarting the node agent service.',
      );
    }
  }
}

async function retryDomainRuntimeNetworkReconcile(
  input: SystemDomainRuntimeApplyInput,
  install: ReadSelfHostedInstallResult,
  environmentText: string,
): Promise<void> {
  reportProgress(input, 'Restarting node agent service before retrying runtime network attachments...');
  await restartNodeAgentHostService({ envPath: install.installPaths.stagedAssetPaths.envPath });
  reportProgress(input, 'Reconciling runtime network attachments...');
  await reconcileNodeAgentRuntimeNetworks({ environmentText });
}

function reportProgress(input: SystemDomainRuntimeApplyInput, message: string): void {
  input.context?.reportProgress?.(message);
}
