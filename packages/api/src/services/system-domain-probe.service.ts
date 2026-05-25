import { buildControlPlaneHost } from '@compartment/contracts';
import { findSystemDomainSetupState } from '../queries/system-domain.query';
import type { SystemDomainSetupStateRow } from '../queries/system-domain.query.types';
import { isActiveDomainProbeOperation } from './system-domain-check.service';
import type { SystemDomainProbeInput, SystemDomainProbeResult } from './system-domain-probe.service.types';
import { readRuntimeDomainHostPlan } from './system-domain-runtime.service';

export async function readSystemDomainProbe(input: SystemDomainProbeInput): Promise<SystemDomainProbeResult | null> {
  const setupState: SystemDomainSetupStateRow | undefined = await findSystemDomainSetupState();
  if (!matchesExpectedDomainProbe(setupState, input)) {
    return null;
  }

  return { ok: true };
}

function matchesExpectedDomainProbe(
  setupState: SystemDomainSetupStateRow | undefined,
  input: SystemDomainProbeInput,
): boolean {
  if (isActiveDomainProbeOperation(input.operationId)) {
    return input.host === buildControlPlaneHost(readRuntimeDomainHostPlan().baseDomain);
  }

  return (
    input.operationId === setupState?.pendingOperationId &&
    setupState.pendingBaseDomain !== null &&
    input.host === buildControlPlaneHost(setupState.pendingBaseDomain)
  );
}
