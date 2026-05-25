import type { AppAccessBrowserFlowTarget } from '@compartment/contracts/browser';

export function readAuthFlowTargetFields(
  flowTarget: AppAccessBrowserFlowTarget | null,
): Partial<AppAccessBrowserFlowTarget> {
  return flowTarget ?? {};
}
