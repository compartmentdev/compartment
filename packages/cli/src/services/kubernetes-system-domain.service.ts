import { createHash } from 'node:crypto';
import {
  compartmentSystemDomainActivatePathname,
  compartmentSystemDomainAttachCertificatePathname,
  compartmentSystemDomainResetManagedPathname,
  compartmentSystemDomainSetPathname,
  compartmentSystemDomainStatusPathname,
  compartmentSystemDomainStatusRefreshPathname,
  compartmentSystemDomainVerifyPathname,
  systemDomainMutationResponseSchema,
  systemDomainStatusResponseSchema,
  type DomainHostPlan,
  type SystemDomainAttachCertificateRequest,
  type SystemDomainMutationResponse,
  type SystemDomainPendingOperation,
  type SystemDomainSetRequest,
  type SystemDomainStatusResponse,
  type SystemDomainVersionedRequest,
} from '@compartment/contracts';
import type { JsonValue } from '@compartment/utils';
import { readRetainedManagedKubernetesDomainState } from './kubernetes-install-retained-state.service';
import {
  applyKubernetesDomainRelease,
  applyRuntimeKubernetesDomainRelease,
  commitActiveKubernetesDomainRelease,
  stageKubernetesDomainCertificate,
} from './kubernetes-system-domain-release.service';
import type {
  KubernetesDomainCertificateInput,
  KubernetesDomainSetInput,
  KubernetesDomainVersionedInput,
  KubernetesOperatorTarget,
  StagedKubernetesDomainCertificate,
} from './kubernetes-operator.service.types';
import type { RetainedManagedDomainState } from './kubernetes-install.service.types';
import { requestKubernetesSystemApi } from './kubernetes-system-api.service';

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
  const status: SystemDomainStatusResponse = await readSystemDomainStatus(input);
  const body: SystemDomainSetRequest = {
    expectedSetupVersion: status.setupVersion,
    hostPlan: buildCustomDomainHostPlan(input),
  };
  return await postDomainMutation(input, compartmentSystemDomainSetPathname, status.setupVersion, body);
}

export async function attachKubernetesSystemDomainCertificate(
  input: KubernetesDomainCertificateInput,
): Promise<SystemDomainMutationResponse> {
  const status: SystemDomainStatusResponse = await readSystemDomainStatus(input);
  const expectedVersion: number = resolveExpectedVersion(input.expectedSetupVersion, status.setupVersion);
  const pending: SystemDomainPendingOperation = requirePendingCustomCertificate(status);
  const staged: StagedKubernetesDomainCertificate = await stageKubernetesDomainCertificate(input, pending.operationId);
  await applyKubernetesDomainRelease(input, {
    pendingCertificate: staged.certificate,
    pendingOperationId: pending.operationId,
    pendingPrivateKey: staged.privateKey,
    pendingTlsSecretName: staged.secretName,
  });
  const body: SystemDomainAttachCertificateRequest = { expectedSetupVersion: expectedVersion };
  return await postDomainMutation(
    input,
    compartmentSystemDomainAttachCertificatePathname,
    expectedVersion,
    body,
    staged.fingerprint,
  );
}

export async function verifyKubernetesSystemDomain(
  input: KubernetesDomainVersionedInput,
): Promise<SystemDomainMutationResponse> {
  const status: SystemDomainStatusResponse = await readSystemDomainStatus(input);
  const expectedVersion: number = resolveExpectedVersion(input.expectedSetupVersion, status.setupVersion);
  const body: SystemDomainVersionedRequest = { expectedSetupVersion: expectedVersion };
  return await postDomainMutation(input, compartmentSystemDomainVerifyPathname, expectedVersion, body);
}

export async function activateKubernetesSystemDomain(
  input: KubernetesDomainVersionedInput,
): Promise<SystemDomainMutationResponse> {
  const status: SystemDomainStatusResponse = await readSystemDomainStatus(input);
  const expectedVersion: number = resolveExpectedVersion(input.expectedSetupVersion, status.setupVersion);
  if (status.pending === null) {
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
  await applyRuntimeKubernetesDomainRelease(input, pending.hostPlan, verified.setupVersion, pending.operationId);
  const activated: SystemDomainMutationResponse = await postDomainMutation(
    input,
    compartmentSystemDomainActivatePathname,
    verified.setupVersion,
    { expectedSetupVersion: verified.setupVersion },
  );
  await commitActiveKubernetesDomainRelease(
    input,
    activated.status.active,
    activated.setupVersion,
    pending.operationId,
  );
  return activated;
}

async function verifyPendingKubernetesSystemDomain(
  input: KubernetesDomainVersionedInput,
  expectedVersion: number,
): Promise<SystemDomainMutationResponse> {
  return await postDomainMutation(input, compartmentSystemDomainVerifyPathname, expectedVersion, {
    expectedSetupVersion: expectedVersion,
  });
}

export async function resetManagedKubernetesSystemDomain(
  input: KubernetesDomainVersionedInput,
): Promise<SystemDomainMutationResponse> {
  const status: SystemDomainStatusResponse = await readSystemDomainStatus(input);
  const expectedVersion: number = resolveExpectedVersion(input.expectedSetupVersion, status.setupVersion);
  const managed: RetainedManagedDomainState = await readRetainedManagedKubernetesDomainState(input);
  const hostPlan: DomainHostPlan = {
    baseDomain: managed.baseDomain,
    caddyMode: 'managed',
    domainKind: 'managed',
    publicScheme: managed.publicProtocol,
    tlsMode: 'broker-dns01',
  };
  await applyRuntimeKubernetesDomainRelease(input, hostPlan, expectedVersion + 1);
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
  body: SystemDomainSetRequest | SystemDomainAttachCertificateRequest | SystemDomainVersionedRequest,
  seed?: string,
): Promise<SystemDomainMutationResponse> {
  return await requestKubernetesSystemApi(
    target,
    {
      body,
      idempotencyKey: buildIdempotencyKey(path, version, body, seed),
      method: 'POST',
      path,
    },
    parseSystemDomainMutation,
  );
}

function buildCustomDomainHostPlan(input: KubernetesDomainSetInput): DomainHostPlan {
  return {
    baseDomain: input.baseDomain,
    caddyMode: input.tlsMode === 'custom-cert' ? 'custom-cert' : 'custom-http',
    domainKind: 'custom',
    publicScheme: 'https',
    tlsMode: input.tlsMode,
  };
}

function requirePendingCustomCertificate(status: SystemDomainStatusResponse): SystemDomainPendingOperation {
  const pending: SystemDomainPendingOperation | null = status.pending;
  if (pending?.hostPlan.tlsMode !== 'custom-cert') {
    throw new Error('No pending custom-certificate domain operation was found.');
  }
  return pending;
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

function buildIdempotencyKey(
  path: string,
  version: number,
  body: SystemDomainSetRequest | SystemDomainAttachCertificateRequest | SystemDomainVersionedRequest,
  seed?: string,
): string {
  const hash: string = createHash('sha256')
    .update(JSON.stringify({ body, path, ...(seed === undefined ? {} : { seed }), version }))
    .digest('hex')
    .slice(0, 24);
  return `domain-${version.toString()}-${hash}`;
}

function parseSystemDomainStatus(value: JsonValue | null): SystemDomainStatusResponse {
  return systemDomainStatusResponseSchema.parse(value);
}

function parseSystemDomainMutation(value: JsonValue | null): SystemDomainMutationResponse {
  return systemDomainMutationResponseSchema.parse(value);
}
