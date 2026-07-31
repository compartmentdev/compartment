import type { JsonValue } from '@compartment/utils';
import { runCommand } from '../command-runner';
import type { CommandResult } from '../command-runner.types';
import { buildKubectlCommand } from './kubernetes-command.support';
import type {
  KubernetesBuildRuntimeAssessment,
  KubernetesBuildRuntimePreflightInput,
  KubernetesRuntimeClassItem,
  KubernetesRuntimeClassList,
} from './kubernetes-build-runtime-preflight.service.types';

const gvisorRuntimeHandler: string = 'runsc';

export async function inspectKubernetesBuildRuntime(
  input: KubernetesBuildRuntimePreflightInput,
): Promise<KubernetesBuildRuntimeAssessment> {
  const inspection: KubernetesRuntimeClassList | KubernetesBuildRuntimeAssessment = await readRuntimeClasses(input);
  if (!('items' in inspection)) {
    return inspection;
  }
  return assessRuntimeClasses(inspection, input.runtimeClassName);
}

async function readRuntimeClasses(
  input: KubernetesBuildRuntimePreflightInput,
): Promise<KubernetesRuntimeClassList | KubernetesBuildRuntimeAssessment> {
  const result: CommandResult = await runCommand(
    buildKubectlCommand(
      {
        kubeContext: input.kubeContext,
        kubeconfigPath: input.kubeconfigPath,
        namespace: 'default',
      },
      ['get', 'runtimeclasses.node.k8s.io', '--output', 'json'],
    ),
  );
  if (result.exitCode !== 0) {
    return unverifiedAssessment(readRuntimeClassListFailureReason(result));
  }

  const runtimeClasses: KubernetesRuntimeClassList | undefined = parseRuntimeClasses(result.stdout);
  return runtimeClasses ?? unverifiedAssessment('Kubernetes returned an unreadable RuntimeClass list');
}

function assessRuntimeClasses(
  runtimeClasses: KubernetesRuntimeClassList,
  requestedName: string,
): KubernetesBuildRuntimeAssessment {
  if (requestedName !== '') {
    return assessRequestedRuntimeClass(runtimeClasses, requestedName);
  }
  return assessOptionalGvisorRuntime(runtimeClasses);
}

function assessRequestedRuntimeClass(
  runtimeClasses: KubernetesRuntimeClassList,
  requestedName: string,
): KubernetesBuildRuntimeAssessment {
  if (
    !runtimeClasses.items.some((item: KubernetesRuntimeClassItem): boolean => item.metadata?.name === requestedName)
  ) {
    throw new Error(
      `Build RuntimeClass "${requestedName}" was requested but does not exist in the cluster. Install that RuntimeClass or clear buildkit.runtimeClassName to use the node default runtime.`,
    );
  }
  return {
    detail: `Build RuntimeClass "${requestedName}" exists in the cluster.`,
    kind: 'configured',
  };
}

function assessOptionalGvisorRuntime(runtimeClasses: KubernetesRuntimeClassList): KubernetesBuildRuntimeAssessment {
  const gvisorRuntimeClass: KubernetesRuntimeClassItem | undefined = runtimeClasses.items.find(
    (item: KubernetesRuntimeClassItem): boolean => item.handler === gvisorRuntimeHandler && item.metadata?.name !== '',
  );
  const gvisorName: string | undefined = gvisorRuntimeClass?.metadata?.name;
  if (gvisorName !== undefined) {
    return {
      detail: `Optional gVisor RuntimeClass "${gvisorName}" was found. To sandbox source builds with it, set buildkit.runtimeClassName=${gvisorName} in the install values.`,
      kind: 'discovered',
    };
  }

  return {
    detail:
      'Build runtime warning: source builds will run without the optional gVisor sandbox, using the nodes’ default container runtime. Install gVisor on build nodes and set buildkit.runtimeClassName later to add kernel-level sandboxing.',
    kind: 'default-runtime',
  };
}

function unverifiedAssessment(reason: string): KubernetesBuildRuntimeAssessment {
  return {
    detail: `Build runtime warning: ${reason}. Review cluster access and buildkit.runtimeClassName before the first source build.`,
    kind: 'unverified',
  };
}

function readRuntimeClassListFailureReason(result: CommandResult): string {
  const diagnostics: string = `${result.stderr}\n${result.stdout}`;
  return /(?:forbidden|unauthorized)/iu.test(diagnostics)
    ? 'the current credentials cannot list node.k8s.io/runtimeclasses'
    : 'could not list node.k8s.io/runtimeclasses with the current cluster access';
}

function parseRuntimeClasses(value: string): KubernetesRuntimeClassList | undefined {
  try {
    const parsed: JsonValue = JSON.parse(value) as JsonValue;
    if (!isObject(parsed) || !Array.isArray(parsed.items)) {
      return undefined;
    }
    return { items: parsed.items.filter(isRuntimeClassItem) };
  } catch {
    return undefined;
  }
}

function isRuntimeClassItem(value: JsonValue): value is KubernetesRuntimeClassItem & JsonValue {
  return isObject(value);
}

function isObject(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
