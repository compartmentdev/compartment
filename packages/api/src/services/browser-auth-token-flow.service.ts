import { createId } from '../lib/tokens';
import {
  consumeBrowserAuthTokenFlow as persistBrowserAuthTokenFlowConsumption,
  createBrowserAuthTokenFlow,
  deleteStaleBrowserAuthTokenFlows,
  findActiveBrowserAuthTokenFlow,
} from '../queries/browser-auth-token-flow.query';
import type { BrowserAuthTokenFlowKind, BrowserAuthTokenFlowRow } from '../queries/browser-auth-token-flow.query.types';
import type {
  BrowserAuthTokenFlowPlan,
  CreateBrowserAuthTokenFlowPlanInput,
} from './browser-auth-token-flow.service.types';
import {
  decryptBrowserAuthTokenFlowToken,
  encryptBrowserAuthTokenFlowToken,
} from './browser-auth-token-flow-crypto.service';

const browserAuthTokenFlowTtlMs: number = 7 * 24 * 60 * 60 * 1000;

export async function createBrowserAuthTokenFlowPlan(
  input: CreateBrowserAuthTokenFlowPlanInput,
): Promise<BrowserAuthTokenFlowPlan | undefined> {
  const now: Date = new Date();
  const expiresAt: Date | undefined = readBrowserAuthTokenFlowExpiresAt(now, input.sourceTokenExpiresAt);
  if (expiresAt === undefined) {
    return undefined;
  }

  const plan: BrowserAuthTokenFlowPlan = {
    expiresAt,
    flowId: createId('batf'),
  };

  await deleteStaleBrowserAuthTokenFlows(now);
  await createBrowserAuthTokenFlow({
    expiresAt: plan.expiresAt,
    id: plan.flowId,
    kind: input.kind,
    tokenCiphertext: encryptBrowserAuthTokenFlowToken(input.token),
  });

  return plan;
}

export async function readBrowserAuthTokenFlowToken(
  kind: BrowserAuthTokenFlowKind,
  flowId: string | undefined,
): Promise<string | undefined> {
  if (flowId === undefined) {
    return undefined;
  }

  const now: Date = new Date();
  const flow: BrowserAuthTokenFlowRow | undefined = await findActiveBrowserAuthTokenFlow(flowId, kind, now);
  if (flow === undefined) {
    return undefined;
  }

  try {
    return decryptBrowserAuthTokenFlowToken(flow.tokenCiphertext);
  } catch {
    await persistBrowserAuthTokenFlowConsumption(flowId, kind, now);
    return undefined;
  }
}

export async function consumeBrowserAuthTokenFlow(
  kind: BrowserAuthTokenFlowKind,
  flowId: string | undefined,
): Promise<void> {
  if (flowId !== undefined) {
    await persistBrowserAuthTokenFlowConsumption(flowId, kind, new Date());
  }
}

function readBrowserAuthTokenFlowExpiresAt(now: Date, sourceTokenExpiresAt: Date): Date | undefined {
  if (sourceTokenExpiresAt <= now) {
    return undefined;
  }

  const flowExpiresAt: Date = new Date(now.getTime() + browserAuthTokenFlowTtlMs);
  return flowExpiresAt < sourceTokenExpiresAt ? flowExpiresAt : sourceTokenExpiresAt;
}
