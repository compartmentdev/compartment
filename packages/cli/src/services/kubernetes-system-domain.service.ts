import {
  compartmentSystemDomainActivatePathname,
  compartmentSystemDomainResetManagedPathname,
  compartmentSystemDomainSetPathname,
  compartmentSystemDomainStatusPathname,
  compartmentSystemDomainStatusRefreshPathname,
  compartmentSystemDomainVerifyPathname,
  type DomainHostPlan,
  type SystemDomainMutationResponse,
  type SystemDomainPendingOperation,
  type SystemDomainSetRequest,
  type SystemDomainStatusResponse,
  type SystemDomainVersionedRequest,
} from '@compartment/contracts';
import { readRetainedManagedKubernetesDomainState } from './kubernetes-install-retained-state.service';
import {
  applyRuntimeKubernetesDomainRelease,
  commitActiveKubernetesDomainRelease,
} from './kubernetes-system-domain-release.service';
import type {
  KubernetesDomainSetInput,
  KubernetesDomainVersionedInput,
  KubernetesOperatorTarget,
} from './kubernetes-operator.service.types';
import type { RetainedManagedDomainState } from './kubernetes-install.service.types';
import { requestKubernetesSystemApi } from './kubernetes-system-api.service';
import { waitForKubernetesSystemDomainReadiness } from './kubernetes-system-domain-readiness.service';
import {
  buildSystemDomainIdempotencyKey,
  parseSystemDomainMutation,
  parseSystemDomainStatus,
} from './kubernetes-system-domain-request.service';
import { assertPublicDns01IssuerAssessment, inspectOperatorIssuer } from './kubernetes-operator-issuer-trust.service';

export async function getKubernetesSystemDomainStatus(
  target: KubernetesOperatorTarget,
): Promise<SystemDomainStatusResponse> {
  return await requestKubernetesSystemApi(
    target,
    { method: 'POST', path: compartmentSystemDomainStatusRefreshPathname },
    parseSystemDomainStatus,
  );
}

export async function setKubernetesSystemDomain(
  input: KubernetesDomainSetInput,
): Promise<SystemDomainMutationResponse> {
  assertPublicDns01IssuerAssessment(input.issuerRef, await inspectOperatorIssuer(input, input.issuerRef));
  const status: SystemDomainStatusResponse = await readSystemDomainStatus(input);
  const body: SystemDomainSetRequest = {
    expectedSetupVersion: status.setupVersion,
    hostPlan: buildCustomDomainHostPlan(input),
  };
  return await postDomainMutation(input, compartmentSystemDomainSetPathname, status.setupVersion, body);
}

export async function verifyKubernetesSystemDomain(
  input: KubernetesDomainVersionedInput,
): Promise<SystemDomainMutationResponse> {
  const status: SystemDomainStatusResponse = await readSystemDomainStatus(input);
  const expectedVersion: number = resolveExpectedVersion(input.expectedSetupVersion, status.setupVersion);
  const body: SystemDomainVersionedRequest = { expectedSetupVersion: expectedVersion };
  const result: SystemDomainMutationResponse = await postDomainMutation(
    input,
    compartmentSystemDomainVerifyPathname,
    expectedVersion,
    body,
  );
  assertSystemDomainVerificationConverged(result);
  return result;
}

export async function activateKubernetesSystemDomain(
  input: KubernetesDomainVersionedInput,
): Promise<SystemDomainMutationResponse> {
  const status: SystemDomainStatusResponse = await readSystemDomainStatus(input);
  const expectedVersion: number = resolveExpectedVersion(input.expectedSetupVersion, status.setupVersion);
  if (status.pending === null) {
    await waitForKubernetesSystemDomainReadiness(input, status.active);
    await commitActiveKubernetesDomainRelease(input, status.active, status.setupVersion);
    return { operationId: 'domain-active-runtime-apply', setupVersion: status.setupVersion, status };
  }
  return await activatePendingKubernetesSystemDomain(input, expectedVersion);
}

async function activatePendingKubernetesSystemDomain(
  input: KubernetesDomainVersionedInput,
  expectedVersion: number,
): Promise<SystemDomainMutationResponse> {
  const verified: SystemDomainMutationResponse = await verifyPendingKubernetesSystemDomain(input, expectedVersion);
  const pending: SystemDomainPendingOperation = requireVerifiedPending(verified.status);
  await applyRuntimeKubernetesDomainRelease(input, pending.hostPlan, verified.setupVersion);
  await waitForKubernetesSystemDomainReadiness(input, pending.hostPlan);
  const activated: SystemDomainMutationResponse = await postDomainMutation(
    input,
    compartmentSystemDomainActivatePathname,
    verified.setupVersion,
    { expectedSetupVersion: verified.setupVersion },
  );
  await commitActiveKubernetesDomainRelease(input, activated.status.active, activated.setupVersion);
  return activated;
}

async function verifyPendingKubernetesSystemDomain(
  input: KubernetesDomainVersionedInput,
  expectedVersion: number,
): Promise<SystemDomainMutationResponse> {
  const result: SystemDomainMutationResponse = await postDomainMutation(
    input,
    compartmentSystemDomainVerifyPathname,
    expectedVersion,
    {
      expectedSetupVersion: expectedVersion,
    },
  );
  assertSystemDomainVerificationConverged(result);
  return result;
}

function assertSystemDomainVerificationConverged(result: SystemDomainMutationResponse): void {
  const pending: SystemDomainPendingOperation | null = result.status.pending;
  if (pending === null || pending.status === 'verified') {
    return;
  }
  const failure: string = pending.failureMessage ?? 'DNS ownership or routing is still pending.';
  throw new Error(`System-domain verification did not converge: ${failure}`);
}

export async function resetManagedKubernetesSystemDomain(
  input: KubernetesDomainVersionedInput,
): Promise<SystemDomainMutationResponse> {
  const status: SystemDomainStatusResponse = await readSystemDomainStatus(input);
  const expectedVersion: number = resolveExpectedVersion(input.expectedSetupVersion, status.setupVersion);
  const managed: RetainedManagedDomainState = await readRetainedManagedKubernetesDomainState(input);
  const hostPlan: DomainHostPlan = {
    baseDomain: managed.baseDomain,
    domainKind: 'managed',
    issuerRef: managed.issuerRef,
    publicScheme: managed.publicProtocol,
    tlsMode: 'broker-dns01',
  };
  await applyRuntimeKubernetesDomainRelease(input, hostPlan, expectedVersion + 1);
  await waitForKubernetesSystemDomainReadiness(input, hostPlan);
  const reset: SystemDomainMutationResponse = await postDomainMutation(
    input,
    compartmentSystemDomainResetManagedPathname,
    expectedVersion,
    { expectedSetupVersion: expectedVersion },
  );
  await commitActiveKubernetesDomainRelease(input, reset.status.active, reset.setupVersion);
  return reset;
}

async function readSystemDomainStatus(target: KubernetesOperatorTarget): Promise<SystemDomainStatusResponse> {
  return await requestKubernetesSystemApi(
    target,
    { method: 'GET', path: compartmentSystemDomainStatusPathname },
    parseSystemDomainStatus,
  );
}

async function postDomainMutation(
  target: KubernetesOperatorTarget,
  path: string,
  version: number,
  body: SystemDomainSetRequest | SystemDomainVersionedRequest,
): Promise<SystemDomainMutationResponse> {
  return await requestKubernetesSystemApi(
    target,
    {
      body,
      idempotencyKey: buildSystemDomainIdempotencyKey(path, version, body),
      method: 'POST',
      path,
    },
    parseSystemDomainMutation,
  );
}

function buildCustomDomainHostPlan(input: KubernetesDomainSetInput): DomainHostPlan {
  return {
    baseDomain: input.baseDomain,
    domainKind: 'custom',
    issuerRef: input.issuerRef,
    publicScheme: 'https',
    tlsMode: 'external',
  };
}

function requireVerifiedPending(status: SystemDomainStatusResponse): SystemDomainPendingOperation {
  if (status.pending?.status !== 'verified') {
    throw new Error('The pending domain must remain verified before activation.');
  }
  return status.pending;
}

function resolveExpectedVersion(expected: number | undefined, current: number): number {
  if (expected === undefined || expected === current) {
    return current;
  }
  throw new Error(
    `Expected system-domain setup version ${expected.toString()}, but the current version is ${current.toString()}.`,
  );
}
