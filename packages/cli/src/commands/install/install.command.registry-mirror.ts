import type { CliIo } from '../../app.types';
import { promptYesNoChoice } from '../../prompts/prompt';
import {
  applyKubernetesRegistryMirror,
  canAutoApplyKubernetesRegistryMirror,
  renderKubernetesRegistryMirrorInstructions,
} from '../../services/kubernetes-registry-mirror.service';
import type { KubernetesRegistryMirror } from '../../services/kubernetes-registry-mirror.service.types';
import type { KubernetesOperatorTarget } from '../../services/kubernetes-operator.service.types';
import { renderRegistryMirrorApplyResult } from '../registry-mirror.output';

export async function finishInstallRegistryMirrorSetup(
  io: CliIo,
  target: KubernetesOperatorTarget,
  mirror: KubernetesRegistryMirror,
  skipAutoApply: boolean,
  declarativeInstall: boolean,
): Promise<void> {
  io.stderr(renderKubernetesRegistryMirrorInstructions(mirror));
  if (await shouldAutoApplyRegistryMirror(io, target, skipAutoApply, declarativeInstall)) {
    await applyAndRenderRegistryMirror(io, mirror);
  }
}

async function shouldAutoApplyRegistryMirror(
  io: CliIo,
  target: KubernetesOperatorTarget,
  skipAutoApply: boolean,
  declarativeInstall: boolean,
): Promise<boolean> {
  if (skipAutoApply) {
    io.stderr('Automatic registry mirror setup was skipped by --skip-registry-mirror.\n');
    return false;
  }
  if (!(await canAutoApplyKubernetesRegistryMirror(target))) {
    io.stderr('Automatic registry mirror setup is unavailable; follow the instructions on every k3s node.\n');
    return false;
  }
  if (declarativeInstall) {
    io.stderr('Applying the registry mirror automatically on the local k3s node.\n');
    return true;
  }
  return await promptYesNoChoice(io, 'Apply this registry mirror on the local k3s node now? [Y/n]: ', true);
}

export function renderKubernetesRegistryMirrorDiscoveryFailure(
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

async function applyAndRenderRegistryMirror(io: CliIo, mirror: KubernetesRegistryMirror): Promise<void> {
  try {
    renderRegistryMirrorApplyResult(io, await applyKubernetesRegistryMirror(mirror));
  } catch (error) {
    const message: string = error instanceof Error ? error.message : String(error);
    io.stderr(`Warning: automatic registry mirror setup failed: ${message}\n`);
    io.stderr('Complete the printed registry mirror instructions before the first deploy.\n');
  }
}
