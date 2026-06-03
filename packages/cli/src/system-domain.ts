import {
  compartmentSystemDomainActivatePathname,
  compartmentSystemDomainAttachCertificatePathname,
  compartmentSystemDomainSetPathname,
  compartmentSystemDomainVerifyPathname,
  type DomainHostPlan,
  type SystemDomainPendingOperation,
  type SystemDomainMutationResponse,
  type SystemDomainStatusResponse,
} from '@compartment/contracts';
import { applySelfHostedSystemDomainRuntime } from './self-hosted-domain-runtime';
import {
  createSystemDomainAttachCommandContext,
  createSystemDomainCommandContext,
  getSystemDomainStatus,
  postSystemDomainMutation,
  postSystemDomainStatusRefresh,
  type SystemDomainAttachCommandContext,
  type SystemDomainCommandContext,
} from './system-domain-api';
import {
  stageSystemDomainCertificate,
  type StageSystemDomainCertificateInput,
  type StageSystemDomainCertificateResult,
} from './system-domain-certificate';
import type { InstallProgressReporter } from './install.types';
import type { SelfHostedRuntimeIdentity } from './self-hosted-runtime-identity';
import type { SystemDomainClientConfig } from './system-domain-client.types';
import { buildCustomSystemDomainHostPlan, isCustomCertHostPlan, isCustomHttpHostPlan } from './system-domain-host-plan';
import { resolveExpectedSystemDomainVersion } from './system-domain-version';
import type {
  AttachSelfHostedSystemDomainCertificateInput,
  SelfHostedSystemDomainMutationResult,
  SelfHostedSystemDomainStatusResult,
  SystemDomainRuntimeCertificateInput,
  SetSelfHostedSystemDomainInput,
  VersionedSelfHostedSystemDomainInput,
} from './system-domain.types';

type StagePendingCertificateInput = Omit<StageSystemDomainCertificateInput, 'reportProgress'>;

export async function getSelfHostedSystemDomainStatus(): Promise<SelfHostedSystemDomainStatusResult> {
  const context: SystemDomainCommandContext = await createSystemDomainCommandContext();
  return await postSystemDomainStatusRefresh(context.client);
}

export async function setSelfHostedSystemDomain(
  input: SetSelfHostedSystemDomainInput,
): Promise<SelfHostedSystemDomainMutationResult> {
  const context: SystemDomainCommandContext = await createSystemDomainCommandContext();
  const status: SystemDomainStatusResponse = await getSystemDomainStatus(context.client);

  return await postSystemDomainMutation(context.client, compartmentSystemDomainSetPathname, status.setupVersion, {
    expectedSetupVersion: status.setupVersion,
    hostPlan: buildCustomSystemDomainHostPlan(input),
  });
}

export async function attachSelfHostedSystemDomainCertificate(
  input: AttachSelfHostedSystemDomainCertificateInput,
): Promise<SelfHostedSystemDomainMutationResult> {
  const context: SystemDomainAttachCommandContext = await createSystemDomainAttachCommandContext();
  const status: SystemDomainStatusResponse = await getSystemDomainStatus(context.client);
  const expectedVersion: number = resolveExpectedSystemDomainVersion(input.expectedSetupVersion, status.setupVersion);
  const pendingOperation: SystemDomainPendingOperation = readPendingCustomCertOperation(status);
  const stagedCertificate: StageSystemDomainCertificateResult = await stagePendingCertificate(
    input,
    context.customTlsDirectory,
    context.runtimeIdentity,
    pendingOperation,
  );

  return await postSystemDomainMutation(
    context.client,
    compartmentSystemDomainAttachCertificatePathname,
    expectedVersion,
    {
      expectedSetupVersion: expectedVersion,
    },
    stagedCertificate.requestFingerprint,
  );
}

export async function verifySelfHostedSystemDomain(
  input: VersionedSelfHostedSystemDomainInput,
): Promise<SelfHostedSystemDomainMutationResult> {
  return await postCurrentSystemDomainMutation(input, compartmentSystemDomainVerifyPathname);
}

export async function activateSelfHostedSystemDomain(
  input: VersionedSelfHostedSystemDomainInput,
): Promise<SelfHostedSystemDomainMutationResult> {
  const context: SystemDomainCommandContext = await createSystemDomainCommandContext();
  const status: SystemDomainStatusResponse = await getSystemDomainStatus(context.client);
  const expectedVersion: number = resolveExpectedSystemDomainVersion(input.expectedSetupVersion, status.setupVersion);
  if (status.pending === null) {
    return await applyActiveSystemDomainRuntime(input, status);
  }
  assertVerifiedPendingStatus(status);

  return await activatePendingSystemDomainRuntime(input, context.client, expectedVersion);
}

async function applyActiveSystemDomainRuntime(
  input: VersionedSelfHostedSystemDomainInput,
  status: SystemDomainStatusResponse,
): Promise<SystemDomainMutationResponse> {
  await applySelfHostedSystemDomainRuntime({
    context: input.context,
    hostPlan: readActiveCustomDomainHostPlan(status),
  });

  return createActiveRuntimeApplyResponse(status);
}

async function activatePendingSystemDomainRuntime(
  input: VersionedSelfHostedSystemDomainInput,
  client: SystemDomainClientConfig,
  expectedVersion: number,
): Promise<SystemDomainMutationResponse> {
  const reverifyResult: SystemDomainMutationResponse = await reverifyPendingSystemDomain(client, expectedVersion);
  const pendingOperation: SystemDomainPendingOperation = requireVerifiedPendingOperation(reverifyResult.status);
  await applySelfHostedSystemDomainRuntime({
    certificate: readPendingRuntimeCertificate(pendingOperation.hostPlan, pendingOperation),
    context: input.context,
    hostPlan: pendingOperation.hostPlan,
  });
  const verifiedSetupVersion: number = reverifyResult.setupVersion;

  const result: SystemDomainMutationResponse = await postSystemDomainMutation(
    client,
    compartmentSystemDomainActivatePathname,
    verifiedSetupVersion,
    { expectedSetupVersion: verifiedSetupVersion },
  );

  return result;
}

async function reverifyPendingSystemDomain(
  client: SystemDomainClientConfig,
  expectedVersion: number,
): Promise<SystemDomainMutationResponse> {
  return await postSystemDomainMutation(client, compartmentSystemDomainVerifyPathname, expectedVersion, {
    expectedSetupVersion: expectedVersion,
  });
}

async function postCurrentSystemDomainMutation(
  input: VersionedSelfHostedSystemDomainInput,
  path: string,
): Promise<SystemDomainMutationResponse> {
  const context: SystemDomainCommandContext = await createSystemDomainCommandContext();
  const status: SystemDomainStatusResponse = await getSystemDomainStatus(context.client);
  const expectedVersion: number = resolveExpectedSystemDomainVersion(input.expectedSetupVersion, status.setupVersion);

  return await postSystemDomainMutation(context.client, path, expectedVersion, {
    expectedSetupVersion: expectedVersion,
  });
}

async function stagePendingCertificate(
  input: AttachSelfHostedSystemDomainCertificateInput,
  customTlsDirectory: string,
  runtimeIdentity: SelfHostedRuntimeIdentity,
  pendingOperation: SystemDomainPendingOperation,
): Promise<StageSystemDomainCertificateResult> {
  const stageInput: StagePendingCertificateInput = {
    certificateFile: input.certificateFile,
    customTlsDirectory,
    operationId: pendingOperation.operationId,
    privateKeyFile: input.privateKeyFile,
    runtimeIdentity,
  };
  const reportProgress: InstallProgressReporter | undefined = input.context?.reportProgress;
  if (reportProgress === undefined) {
    return await stageSystemDomainCertificate(stageInput);
  }

  return await stageSystemDomainCertificate({ ...stageInput, reportProgress });
}

function readActiveCustomDomainHostPlan(status: SystemDomainStatusResponse): DomainHostPlan {
  const hostPlan: DomainHostPlan = status.active;
  if (isCustomHttpHostPlan(hostPlan) || isCustomCertHostPlan(hostPlan)) {
    return hostPlan;
  }

  throw new Error('No verified pending custom domain or active custom domain was found.');
}

function readPendingRuntimeCertificate(
  hostPlan: DomainHostPlan,
  pendingOperation: SystemDomainPendingOperation | null,
): SystemDomainRuntimeCertificateInput | undefined {
  if (!isCustomCertHostPlan(hostPlan)) {
    return undefined;
  }
  if (pendingOperation?.certificate === undefined || pendingOperation.certificate === null) {
    throw new Error('Attach a certificate before activating this custom domain.');
  }

  return {
    certificatePath: pendingOperation.certificate.certificatePath,
    privateKeyPath: pendingOperation.certificate.privateKeyPath,
  };
}

function readPendingCustomCertOperation(status: SystemDomainStatusResponse): SystemDomainPendingOperation {
  const pendingOperation: SystemDomainPendingOperation | null = status.pending;
  if (pendingOperation === null || !isCustomCertHostPlan(pendingOperation.hostPlan)) {
    throw new Error('No pending custom certificate domain operation was found.');
  }

  return pendingOperation;
}

function createActiveRuntimeApplyResponse(status: SystemDomainStatusResponse): SystemDomainMutationResponse {
  return {
    setupVersion: status.setupVersion,
    operationId: 'domain-active-runtime-apply',
    status,
  };
}

function assertVerifiedPendingStatus(status: SystemDomainStatusResponse): void {
  if (status.pending?.status !== 'verified') {
    throw new Error('The pending domain must be verified before activation.');
  }
}

function requireVerifiedPendingOperation(status: SystemDomainStatusResponse): SystemDomainPendingOperation {
  const pendingOperation: SystemDomainPendingOperation | null = status.pending;
  if (pendingOperation?.status !== 'verified') {
    throw new Error('The pending domain must remain verified before activation.');
  }

  return pendingOperation;
}
