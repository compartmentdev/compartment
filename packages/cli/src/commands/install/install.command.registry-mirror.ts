import type { CliIo } from '../../app.types';
import { promptYesNoChoice } from '../../prompts/prompt';
import {
  applyKubernetesRegistryMirror,
  canAutoApplyKubernetesRegistryMirror,
  hasMultipleKubernetesNodes,
  readInstalledKubernetesRegistryMirror,
  renderKubernetesRegistryMirrorInstructions,
} from '../../services/kubernetes-registry-mirror.service';
import type {
  KubernetesRegistryMirror,
  KubernetesRegistryMirrorApplyResult,
} from '../../services/kubernetes-registry-mirror.service.types';
import type { KubernetesOperatorTarget } from '../../services/kubernetes-operator.service.types';
import { renderRegistryMirrorApplyResult } from '../registry-mirror.output';

export async function finishDiscoveredInstallRegistryMirrorSetup(
  io: CliIo,
  target: KubernetesOperatorTarget,
  skipAutoApply: boolean,
  declarativeInstall: boolean,
): Promise<void> {
  let mirror: KubernetesRegistryMirror;
  try {
    mirror = await readInstalledKubernetesRegistryMirror(target);
  } catch (error) {
    const failureMessage: string = error instanceof Error ? error.message : String(error);
    io.stderr(renderKubernetesRegistryMirrorDiscoveryFailure(target, failureMessage));
    return;
  }
  await finishInstallRegistryMirrorSetup(io, target, mirror, skipAutoApply, declarativeInstall);
}

async function finishInstallRegistryMirrorSetup(
  io: CliIo,
  target: KubernetesOperatorTarget,
  mirror: KubernetesRegistryMirror,
  skipAutoApply: boolean,
  declarativeInstall: boolean,
): Promise<void> {
  const needsInstructions: boolean = await configureLocalRegistryMirror(
    io,
    target,
    mirror,
    skipAutoApply,
    declarativeInstall,
  );
  if (needsInstructions) {
    io.stderr(renderKubernetesRegistryMirrorInstructions(mirror));
  }
}

async function configureLocalRegistryMirror(
  io: CliIo,
  target: KubernetesOperatorTarget,
  mirror: KubernetesRegistryMirror,
  skipAutoApply: boolean,
  declarativeInstall: boolean,
): Promise<boolean> {
  if (skipAutoApply) {
    io.stderr('Automatic registry mirror setup was skipped by --skip-registry-mirror.\n');
    writeRegistryMirrorDeclineWarning(io, mirror);
    return true;
  }
  if (!(await canAutoApplyKubernetesRegistryMirror(target))) {
    io.stderr('Automatic registry mirror setup is unavailable on this machine.\n');
    writeRegistryMirrorDeclineWarning(io, mirror);
    return true;
  }
  if (declarativeInstall) {
    io.stderr('Applying the registry mirror automatically on the local k3s node.\n');
    return await applyLocalRegistryMirror(io, target, mirror);
  }
  return await configureGuidedRegistryMirror(io, target, mirror);
}

async function configureGuidedRegistryMirror(
  io: CliIo,
  target: KubernetesOperatorTarget,
  mirror: KubernetesRegistryMirror,
): Promise<boolean> {
  const shouldApply: boolean = await promptYesNoChoice(
    io,
    'Configure the registry mirror on this k3s node (writes /etc/rancher/k3s/registries.yaml, restarts k3s)? [Y/n]: ',
    true,
  );
  if (!shouldApply) {
    writeRegistryMirrorDeclineWarning(io, mirror);
    return true;
  }
  return await applyLocalRegistryMirror(io, target, mirror);
}

async function applyLocalRegistryMirror(
  io: CliIo,
  target: KubernetesOperatorTarget,
  mirror: KubernetesRegistryMirror,
): Promise<boolean> {
  if (!(await applyAndRenderRegistryMirror(io, mirror))) {
    return true;
  }
  return await hasMultipleKubernetesNodes(target);
}

function writeRegistryMirrorDeclineWarning(io: CliIo, mirror: KubernetesRegistryMirror): void {
  io.stderr(
    `Registry mirror not configured. Until you apply it, the first deploy cannot pull images. Retry: compartment system registry-mirror apply --registry-host '${mirror.host}' --cluster-ip '${mirror.clusterIp}'.\n`,
  );
}

function renderKubernetesRegistryMirrorDiscoveryFailure(
  target: KubernetesOperatorTarget,
  failureMessage: string,
): string {
  const contextArgument: string = target.kubeContext === undefined ? '' : ` --context '${target.kubeContext}'`;
  return `
Warning: could not inspect the installed registry-auth Service: ${failureMessage}
Registry mirror setup is still required before the first application deploy.
After kubectl access recovers, inspect the retained registry-auth Service:

kubectl${contextArgument} --namespace '${target.namespace}' get service \\
  --selector 'app.kubernetes.io/instance=${target.releaseName}'

Then run this command on every k3s node with the Service name and ClusterIP from kubectl:

sudo compartment system registry-mirror apply \\
  --registry-host '<service-name>.${target.namespace}.svc:5000' \\
  --cluster-ip '<cluster-ip>'
`;
}

async function applyAndRenderRegistryMirror(io: CliIo, mirror: KubernetesRegistryMirror): Promise<boolean> {
  try {
    const result: KubernetesRegistryMirrorApplyResult = await applyKubernetesRegistryMirror(mirror);
    renderRegistryMirrorApplyResult(io, result);
    if (result.current && result.restartError === undefined) {
      io.stderr('✓ Registry mirror configured\n');
      return true;
    }
    return false;
  } catch (error) {
    const message: string = error instanceof Error ? error.message : String(error);
    io.stderr(`Warning: automatic registry mirror setup failed: ${message}\n`);
    io.stderr('Complete the printed registry mirror instructions before the first deploy.\n');
    return false;
  }
}
