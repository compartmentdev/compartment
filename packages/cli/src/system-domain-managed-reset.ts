import {
  compartmentSystemDomainResetManagedPathname,
  type DomainHostPlan,
  type SystemDomainStatusResponse,
} from '@compartment/contracts';
import { applySelfHostedSystemDomainRuntime } from './self-hosted-domain-runtime';
import { buildSelfHostedPathSelection } from './self-hosted-install-paths';
import type { SelfHostedPathSelection } from './self-hosted-install-paths.types';
import { readRequiredSelfHostedInstall } from './self-hosted-install-read';
import type { ReadSelfHostedInstallResult } from './self-hosted-install-read.types';
import { assertManagedDomainTlsMetadata } from './managed-domain-validation';
import type { ManagedDomainInstallState } from './managed-domain.types';
import {
  createSystemDomainCommandContext,
  getSystemDomainStatus,
  postSystemDomainMutation,
  type SystemDomainCommandContext,
} from './system-domain-api';
import type { SystemDomainClientConfig } from './system-domain-client.types';
import { buildManagedSystemDomainHostPlan } from './system-domain-host-plan';
import type { SelfHostedSystemDomainMutationResult, VersionedSelfHostedSystemDomainInput } from './system-domain.types';
import { resolveExpectedSystemDomainVersion } from './system-domain-version';

export async function resetManagedSelfHostedSystemDomain(
  input: VersionedSelfHostedSystemDomainInput,
): Promise<SelfHostedSystemDomainMutationResult> {
  const context: SystemDomainCommandContext = await createSystemDomainCommandContext();
  const status: SystemDomainStatusResponse = await getSystemDomainStatus(context.client);
  const expectedVersion: number = resolveExpectedSystemDomainVersion(input.expectedSetupVersion, status.setupVersion);
  const managedDomainMetadata: ManagedDomainInstallState = await readResetManagedDomainMetadata();
  const managedHostPlan: DomainHostPlan = buildManagedSystemDomainHostPlan(managedDomainMetadata);

  await applySelfHostedSystemDomainRuntime({
    context: input.context,
    hostPlan: managedHostPlan,
    managedDomain: managedDomainMetadata,
  });

  return await postResetManagedDomainMutation(context.client, expectedVersion);
}

async function postResetManagedDomainMutation(
  client: SystemDomainClientConfig,
  expectedVersion: number,
): Promise<SelfHostedSystemDomainMutationResult> {
  return await postSystemDomainMutation(client, compartmentSystemDomainResetManagedPathname, expectedVersion, {
    expectedSetupVersion: expectedVersion,
  });
}

async function readResetManagedDomainMetadata(): Promise<ManagedDomainInstallState> {
  const paths: SelfHostedPathSelection = buildSelfHostedPathSelection();
  const install: ReadSelfHostedInstallResult = await readRequiredSelfHostedInstall(paths);
  const managedDomainMetadata: ManagedDomainInstallState | undefined = install.state.managedDomain;
  if (managedDomainMetadata === undefined) {
    throw new Error('This install does not have a managed domain to reset to.');
  }
  assertManagedDomainTlsMetadata(managedDomainMetadata);

  return managedDomainMetadata;
}
