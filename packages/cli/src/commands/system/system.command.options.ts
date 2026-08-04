import { hasText, isValidDnsHostname, normalizeDnsHostname } from '@compartment/utils';
import type { Command } from 'commander';
import type { KubernetesOperatorTarget } from '../../services/kubernetes-operator.service.types';
import {
  readKubernetesPlatformImageTag,
  resolvePackagedKubernetesPlatformVersion,
} from '../../services/kubernetes-platform-version.service';
import type {
  KubernetesOperatorCommandOptions,
  ResolvedSystemDomainVersionedCommand,
  SystemDomainVersionedCommandOptions,
} from './system.command.types';

const defaultKubernetesNamespace: string = 'compartment';
const defaultKubernetesReleaseName: string = 'compartment';
const maximumSetupVersion: number = 2_147_483_647;
export const systemDomainExpectedVersionDescription: string = `Domain setup version from 0 to ${maximumSetupVersion.toString()}`;
const systemDomainExpectedVersionError: string = `Expected --expected-version to be an integer from 0 to ${maximumSetupVersion.toString()}.`;
const kubernetesNamePattern: RegExp = /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/u;

export function addKubernetesOperatorReleaseOptions(command: Command): Command {
  return addKubernetesOperatorTargetOptions(command)
    .option('--values <path>', 'Operator values file for the Compartment Helm chart')
    .option('--chart <path>', 'Compartment Helm chart path for a source CLI build');
}

export function addKubernetesOperatorTargetOptions(command: Command): Command {
  return command
    .option('--kube-context <name>', 'Kubernetes context')
    .option('--namespace <name>', 'Kubernetes namespace; defaults to compartment')
    .option('--release-name <name>', 'Helm release name; defaults to compartment')
    .option('--output <format>', 'text or json', 'text');
}

export function resolveSystemDomainVersionedCommand(
  options: SystemDomainVersionedCommandOptions,
): ResolvedSystemDomainVersionedCommand {
  const expectedSetupVersion: number | undefined = readExpectedSetupVersion(options.expectedVersion);
  return expectedSetupVersion === undefined ? {} : { expectedSetupVersion };
}

export function resolveKubernetesOperatorTarget(options: KubernetesOperatorCommandOptions): KubernetesOperatorTarget {
  const namespace: string = normalizeKubernetesName(options.namespace ?? defaultKubernetesNamespace, '--namespace', 63);
  const releaseName: string = normalizeKubernetesName(
    options.releaseName ?? defaultKubernetesReleaseName,
    '--release-name',
    53,
  );
  return {
    ...(hasText(options.chart) ? { chartPath: options.chart } : {}),
    ...(hasText(options.kubeContext) ? { kubeContext: options.kubeContext } : {}),
    namespace,
    releaseName,
    ...(hasText(options.values) ? { valuesPath: options.values } : {}),
  };
}

export function readSystemDomainBaseDomain(value: string): string {
  const normalized: string = normalizeDnsHostname(value);
  if (!isValidDnsHostname(normalized) || normalized === 'localhost' || normalized.endsWith('.localhost')) {
    throw new Error('--base-domain must be a public DNS base domain without a port.');
  }
  return normalized;
}

export function resolveKubernetesSystemUpdateVersion(value: string | undefined): string {
  if (value !== undefined) {
    return readSystemUpdateImageTag(value);
  }
  const packagedVersion: string | undefined = resolvePackagedKubernetesPlatformVersion();
  if (packagedVersion !== undefined) {
    return packagedVersion;
  }
  throw new Error('--version is required when system update runs from a source CLI build.');
}

function readSystemUpdateImageTag(value: string): string {
  try {
    return readKubernetesPlatformImageTag(value);
  } catch {
    throw new Error('--version must be a valid platform image tag.');
  }
}

function readExpectedSetupVersion(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (/^\d+$/u.test(value)) {
    const setupVersion: number = Number(value);
    if (Number.isSafeInteger(setupVersion) && setupVersion <= maximumSetupVersion) {
      return setupVersion;
    }
  }
  throw new Error(systemDomainExpectedVersionError);
}

function normalizeKubernetesName(value: string, optionName: string, maximumLength: number): string {
  const normalized: string = value.trim().toLowerCase();
  if (normalized.length === 0 || normalized.length > maximumLength || !kubernetesNamePattern.test(normalized)) {
    throw new Error(
      `${optionName} must be a valid Kubernetes name with at most ${maximumLength.toString()} characters.`,
    );
  }
  return normalized;
}
