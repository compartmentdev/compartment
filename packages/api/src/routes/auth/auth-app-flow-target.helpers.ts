import { canIssueAppAccessRedirect } from '../../services/app-access.service';
import type { BrowserFlowTargetOrNull } from '../browser/browser-flow.types';
import { type ResolvedAuthSessionDelivery, usesSessionCookie } from './auth-token-input.helpers';

export async function resolveCookieAppFlowTarget(
  sessionDelivery: ResolvedAuthSessionDelivery,
  flowTarget: BrowserFlowTargetOrNull,
  sessionId: string,
): Promise<BrowserFlowTargetOrNull> {
  if (!usesSessionCookie(sessionDelivery) || flowTarget === null) {
    return flowTarget;
  }
  if (
    await canIssueAppAccessRedirect({
      host: flowTarget.host,
      path: flowTarget.path,
      sessionId,
    })
  ) {
    return flowTarget;
  }

  return null;
}
