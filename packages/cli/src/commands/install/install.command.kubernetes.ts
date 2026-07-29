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
import { readConfiguredInstallAdminPassword } from './install.command.identity';
import { resolveCanonicalKubernetesInstallWizard } from './install.command.kubernetes-wizard';
import { resolvePreflightKubeconfig } from './install.command.preflight';
import { renderInstallResult } from './install.command.result';
import { persistInstallSession } from './install.command.session';
import type { InstallCommandOptions } from './install.command.types';
import {
  materializeInstallWizardValues,
  readOperatorInstallInputValues,
  type MaterializedInstallWizardValues,
  type OperatorInstallInputValues,
} from './install.command.values';
import { assertManagedDomainOnboardingAvailable } from '../../services/managed-domain-reservation-token.service';

interface ResolvedInstallValuesPath {
  material?: MaterializedInstallWizardValues | undefined;
  path: string;
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
  await executeWithKubeconfig(dependencies, options, kubeconfig, boundaryValues);
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
    options.values === undefined ? undefined : await readOperatorInstallInputValues(options.values);
  const values: Omit<KubernetesInstallInputValues, 'valuesPath'> = {
    ...readNonInteractiveValues(options),
    ...(options.ingressClass === undefined && operatorValues !== undefined
      ? { ingressClass: operatorValues.ingressClass }
      : {}),
    ...(options.storageClass === undefined && operatorValues !== undefined
      ? { storageClass: operatorValues.storageClass }
      : {}),
  };
  resolveCanonicalKubernetesInstallInput({ ...values, valuesPath: '<pending>' }, '<pending>');
  return values;
}

function assertNonInteractiveDomainAvailable(options: InstallCommandOptions): void {
  assertCanonicalKubernetesInstallDomainChoice(options);
  if (options.managedDomain === true) {
    assertManagedDomainOnboardingAvailable();
  }
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
    const values: Omit<KubernetesInstallInputValues, 'valuesPath'> = await resolveValues(
      dependencies,
      options,
      kubeconfig,
      boundaryValues,
    );
    const resolvedValuesPath: ResolvedInstallValuesPath = await resolveInstallValuesPath(options, values);
    material = resolvedValuesPath.material;
    await runCanonicalInstall(dependencies, options, kubeconfig, values, resolvedValuesPath.path, progress);
  } finally {
    progress.stop();
    await cleanCanonicalMaterial(material, kubeconfig);
  }
}

async function resolveInstallValuesPath(
  options: InstallCommandOptions,
  values: Omit<KubernetesInstallInputValues, 'valuesPath'>,
): Promise<ResolvedInstallValuesPath> {
  if (options.values !== undefined) {
    return { path: options.values };
  }
  const material: MaterializedInstallWizardValues = await materializeInstallWizardValues({
    storage: { storageClass: values.storageClass ?? '' },
  });
  return { material, path: material.path };
}

async function resolveValues(
  dependencies: CliCommandDependencies,
  options: InstallCommandOptions,
  kubeconfig: ResolvedKubernetesKubeconfig,
  boundaryValues: Omit<KubernetesInstallInputValues, 'valuesPath'> | undefined,
): Promise<Omit<KubernetesInstallInputValues, 'valuesPath'>> {
  if (boundaryValues !== undefined) {
    return boundaryValues;
  }
  const inventory: KubernetesInstallInventory = await readKubernetesInstallInventory({
    resolvedKubeconfig: kubeconfig,
  });
  return (
    await resolveCanonicalKubernetesInstallWizard(
      dependencies.io,
      options,
      inventory,
      async (contextName: string): Promise<KubernetesInstallResourceInventory> =>
        await readKubernetesInstallResourceInventory({ resolvedKubeconfig: kubeconfig }, contextName),
    )
  ).input;
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
  const applicationInput: KubernetesInstallApplicationInput = buildApplicationInput(input, options, progress);
  const result: KubernetesInstallApplicationResult = await installIntoKubernetes(applicationInput);
  await persistInstallSession(result.install, options.remote);
  renderInstallResult(dependencies.io, options.output, result.install, false);
}

function buildApplicationInput(
  input: KubernetesInstallInput,
  options: InstallCommandOptions,
  progress: CommandProgress,
): KubernetesInstallApplicationInput {
  return {
    ...input,
    ...(options.apiUrl === undefined ? {} : { apiUrl: options.apiUrl }),
    ...(options.brokerUrl === undefined ? {} : { brokerUrl: options.brokerUrl }),
    ...(options.chart === undefined ? {} : { chartPath: options.chart }),
    ...(options.organizationSlug === undefined ? {} : { organizationSlug: options.organizationSlug }),
    progress,
  };
}

async function cleanCanonicalMaterial(
  material: MaterializedInstallWizardValues | undefined,
  kubeconfig: ResolvedKubernetesKubeconfig,
): Promise<void> {
  if (material !== undefined) {
    await rm(material.directory, { force: true, recursive: true });
  }
  if (kubeconfig.materializedDirectory !== undefined) {
    await rm(kubeconfig.materializedDirectory, { force: true, recursive: true });
  }
}

function readNonInteractiveValues(options: InstallCommandOptions): Omit<KubernetesInstallInputValues, 'valuesPath'> {
  const password: string | undefined = options.adminPassword ?? readConfiguredInstallAdminPassword();

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
