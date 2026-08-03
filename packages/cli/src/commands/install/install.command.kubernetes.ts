import { rm } from 'node:fs/promises';
import { installIntoKubernetes } from '../../services/kubernetes-install-application.service';
import {
  readKubernetesInstallInventory,
  readKubernetesInstallResourceInventory,
} from '../../services/kubernetes-install-inventory.service';
import type {
  KubernetesInstallInventory,
  KubernetesInstallResourceInventory,
} from '../../services/kubernetes-install-inventory.service.types';
import type {
  KubernetesInstallApplicationInput,
  KubernetesInstallApplicationResult,
  KubernetesInstallInput,
} from '../../services/kubernetes-install-input.service.types';
import type { ResolvedKubernetesKubeconfig } from '../../services/kubernetes-install-kubeconfig.service.types';
import type { CliCommandDependencies } from '../command.types';
import { createCommandProgress } from '../command.progress';
import type { CommandProgress } from '../command.progress.types';
import {
  assertCanonicalKubernetesInstallDomainChoice,
  resolveCanonicalKubernetesInstallInput,
} from './install.command.input';
import type { KubernetesInstallInputValues } from './install.command.input.types';
import { readBoundaryInstallAdminPassword } from './install.command.identity';
import { resolveCanonicalKubernetesInstallWizard } from './install.command.kubernetes-wizard';
import type {
  InspectKubernetesInstallIssuer,
  KubernetesInstallWizardResult,
} from './install.command.kubernetes-wizard.types';
import { resolvePreflightKubeconfig } from './install.command.preflight';
import { renderInstallResult } from './install.command.result';
import { persistInstallSession } from './install.command.session';
import type { InstallCommandOptions, InstallWizardIssuerReference, InstallWizardValues } from './install.command.types';
import {
  materializeInstallWizardValues,
  readOperatorInstallInputValues,
  type MaterializedInstallWizardValues,
  type OperatorInstallInputValues,
} from './install.command.values';
import { isReservedKubernetesInstallLocalhostDomain } from '../../kubernetes-install-domain';
import { normalizeInstallBaseDomain } from './install.command.validation';
import { withKubernetesLocalTools } from '../../services/kubernetes-local-tools.service';
import { inspectOperatorIssuer } from '../../services/kubernetes-operator-issuer-trust.service';
import type { KubernetesOperatorIssuerAssessment } from '../../services/kubernetes-operator-issuer-trust.service.types';
import { resolveInstallManagedDomainBrokerUrl } from './install.command.options';
import { createKubernetesInstallRetainedStateReader } from './install.command.kubernetes-wizard-retained-state';

interface ResolvedInstallValuesPath {
  material?: MaterializedInstallWizardValues | undefined;
  path: string;
}

interface ResolvedCommandInstallValues {
  input: Omit<KubernetesInstallInputValues, 'valuesPath'>;
  wizardValues?: InstallWizardValues | undefined;
}

export async function executeCanonicalKubernetesInstallCommand(
  dependencies: CliCommandDependencies,
  options: InstallCommandOptions,
): Promise<void> {
  const boundaryValues: Omit<KubernetesInstallInputValues, 'valuesPath'> | undefined = await readBoundaryValues(
    dependencies,
    options,
  );
  const kubeconfig: ResolvedKubernetesKubeconfig = await resolvePreflightKubeconfig(dependencies, options.kubeContext);
  try {
    await withKubernetesLocalTools(async (): Promise<void> => {
      await executeWithKubeconfig(dependencies, options, kubeconfig, boundaryValues);
    });
  } finally {
    if (kubeconfig.materializedDirectory !== undefined) {
      await rm(kubeconfig.materializedDirectory, { force: true, recursive: true });
    }
  }
}

async function readBoundaryValues(
  dependencies: CliCommandDependencies,
  options: InstallCommandOptions,
): Promise<Omit<KubernetesInstallInputValues, 'valuesPath'> | undefined> {
  if (hasInteractiveInput(dependencies) && options.values === undefined) {
    return undefined;
  }
  assertNonInteractiveDomainAvailable(options);
  const operatorValues: OperatorInstallInputValues | undefined =
    options.values === undefined
      ? undefined
      : await readOperatorInstallInputValues(options.values, requiresPublicOperatorTls(options.baseDomain));
  const password: string | undefined = await readBoundaryInstallAdminPassword(dependencies, options);
  const values: Omit<KubernetesInstallInputValues, 'valuesPath'> = mergeOperatorBoundaryValues(
    options,
    operatorValues,
    password,
  );
  resolveCanonicalKubernetesInstallInput({ ...values, valuesPath: '<pending>' }, '<pending>');
  return values;
}

function mergeOperatorBoundaryValues(
  options: InstallCommandOptions,
  operatorValues: OperatorInstallInputValues | undefined,
  password: string | undefined,
): Omit<KubernetesInstallInputValues, 'valuesPath'> {
  return {
    ...readNonInteractiveValues(options, password),
    ...(options.ingressEndpoint === undefined && operatorValues?.clearIngressEndpoint === true
      ? { clearIngressEndpoint: true }
      : {}),
    ...(options.ingressClass === undefined && operatorValues !== undefined
      ? { ingressClass: operatorValues.ingressClass }
      : {}),
    ...(options.ingressEndpoint === undefined && operatorValues?.ingressEndpoint !== undefined
      ? { ingressEndpoint: operatorValues.ingressEndpoint }
      : {}),
    ...(options.storageClass === undefined && operatorValues !== undefined
      ? { storageClass: operatorValues.storageClass }
      : {}),
    ...(operatorValues?.publicProtocol === undefined ? {} : { publicProtocol: operatorValues.publicProtocol }),
  };
}

function requiresPublicOperatorTls(baseDomain: string | undefined): boolean {
  return (
    baseDomain !== undefined && !isReservedKubernetesInstallLocalhostDomain(normalizeInstallBaseDomain(baseDomain))
  );
}

function assertNonInteractiveDomainAvailable(options: InstallCommandOptions): void {
  assertCanonicalKubernetesInstallDomainChoice(options);
}

async function executeWithKubeconfig(
  dependencies: CliCommandDependencies,
  options: InstallCommandOptions,
  kubeconfig: ResolvedKubernetesKubeconfig,
  boundaryValues: Omit<KubernetesInstallInputValues, 'valuesPath'> | undefined,
): Promise<void> {
  let material: MaterializedInstallWizardValues | undefined;
  const progress: CommandProgress = createCommandProgress({ io: dependencies.io, output: options.output });
  try {
    const values: ResolvedCommandInstallValues = await resolveValues(dependencies, options, kubeconfig, boundaryValues);
    const resolvedValuesPath: ResolvedInstallValuesPath = await resolveInstallValuesPath(options, values);
    material = resolvedValuesPath.material;
    await runCanonicalInstall(dependencies, options, kubeconfig, values.input, resolvedValuesPath.path, progress);
  } finally {
    progress.stop();
    await cleanCanonicalMaterial(material);
  }
}

async function resolveInstallValuesPath(
  options: InstallCommandOptions,
  values: ResolvedCommandInstallValues,
): Promise<ResolvedInstallValuesPath> {
  if (options.values !== undefined) {
    return { path: options.values };
  }
  if (values.wizardValues === undefined) {
    throw new Error('Interactive install values were not materialized.');
  }
  const material: MaterializedInstallWizardValues = await materializeInstallWizardValues(values.wizardValues);
  return { material, path: material.path };
}

async function resolveValues(
  dependencies: CliCommandDependencies,
  options: InstallCommandOptions,
  kubeconfig: ResolvedKubernetesKubeconfig,
  boundaryValues: Omit<KubernetesInstallInputValues, 'valuesPath'> | undefined,
): Promise<ResolvedCommandInstallValues> {
  if (boundaryValues !== undefined) {
    return { input: boundaryValues };
  }
  const inventory: KubernetesInstallInventory = await readKubernetesInstallInventory({
    resolvedKubeconfig: kubeconfig,
  });
  const wizard: KubernetesInstallWizardResult = await resolveCanonicalKubernetesInstallWizard(
    dependencies.io,
    options,
    inventory,
    async (contextName: string): Promise<KubernetesInstallResourceInventory> =>
      await readKubernetesInstallResourceInventory({ resolvedKubeconfig: kubeconfig }, contextName),
    createIssuerInspector(kubeconfig),
    createKubernetesInstallRetainedStateReader(kubeconfig),
  );
  return { input: wizard.input, wizardValues: wizard.values };
}

function createIssuerInspector(kubeconfig: ResolvedKubernetesKubeconfig): InspectKubernetesInstallIssuer {
  return async (
    contextName: string,
    namespace: string,
    issuer: InstallWizardIssuerReference,
  ): Promise<KubernetesOperatorIssuerAssessment> =>
    await inspectOperatorIssuer(
      {
        kubeconfigPath: kubeconfig.path,
        kubeContext: contextName,
        namespace,
      },
      issuer,
    );
}

async function runCanonicalInstall(
  dependencies: CliCommandDependencies,
  options: InstallCommandOptions,
  kubeconfig: ResolvedKubernetesKubeconfig,
  values: Omit<KubernetesInstallInputValues, 'valuesPath'>,
  valuesPath: string,
  progress: CommandProgress,
): Promise<void> {
  const input: KubernetesInstallInput = resolveCanonicalKubernetesInstallInput(
    { ...values, valuesPath },
    kubeconfig.path,
  ).input;
  const applicationInput: KubernetesInstallApplicationInput = {
    ...input,
    ...(options.apiUrl === undefined ? {} : { apiUrl: options.apiUrl }),
    ...(input.domain.mode === 'managed' ? { brokerUrl: resolveInstallManagedDomainBrokerUrl(options.brokerUrl) } : {}),
    ...(options.chart === undefined ? {} : { chartPath: options.chart }),
    ...(options.organizationSlug === undefined ? {} : { organizationSlug: options.organizationSlug }),
    progress,
  };
  const result: KubernetesInstallApplicationResult = await installIntoKubernetes(applicationInput);
  await persistInstallSession(result.install, options.remote);
  renderInstallResult(dependencies.io, options.output, result.install, false);
}

async function cleanCanonicalMaterial(material: MaterializedInstallWizardValues | undefined): Promise<void> {
  if (material !== undefined) {
    await rm(material.directory, { force: true, recursive: true });
  }
}

function readNonInteractiveValues(
  options: InstallCommandOptions,
  password: string | undefined,
): Omit<KubernetesInstallInputValues, 'valuesPath'> {
  return {
    ...(options.baseDomain === undefined ? {} : { baseDomain: options.baseDomain }),
    ...(options.email === undefined ? {} : { email: options.email }),
    ...(options.ingressClass === undefined ? {} : { ingressClass: options.ingressClass }),
    ...(options.ingressEndpoint === undefined ? {} : { ingressEndpoint: options.ingressEndpoint }),
    ...(options.kubeContext === undefined ? {} : { kubeContext: options.kubeContext }),
    ...(options.managedDomain === undefined ? {} : { managedDomain: options.managedDomain }),
    ...(options.namespace === undefined ? {} : { namespace: options.namespace }),
    ...(options.organization === undefined ? {} : { organization: options.organization }),
    ...(password === undefined ? {} : { password }),
    ...(options.releaseName === undefined ? {} : { releaseName: options.releaseName }),
    ...(options.storageClass === undefined ? {} : { storageClass: options.storageClass }),
  };
}

function hasInteractiveInput(dependencies: CliCommandDependencies): boolean {
  return (dependencies.io.stdin as { isTTY?: boolean | undefined }).isTTY === true;
}
