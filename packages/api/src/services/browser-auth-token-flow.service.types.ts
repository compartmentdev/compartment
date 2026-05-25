import type { BrowserAuthTokenFlowKind } from '../queries/browser-auth-token-flow.query.types';

export interface BrowserAuthTokenFlowPlan {
  expiresAt: Date;
  flowId: string;
}

export interface CreateBrowserAuthTokenFlowPlanInput {
  kind: BrowserAuthTokenFlowKind;
  sourceTokenExpiresAt: Date;
  token: string;
}
