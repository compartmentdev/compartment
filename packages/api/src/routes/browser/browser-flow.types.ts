import type { AppAccessBrowserFlowTarget } from '@compartment/contracts';

export interface BrowserFlowFields {
  host?: string | undefined;
  path?: string | undefined;
  state?: string | undefined;
}

export interface BrowserSsoQuery extends BrowserFlowFields {
  provider?: string | undefined;
  successRedirectTo?: string | undefined;
}

export type BrowserFlowTargetOrNull = AppAccessBrowserFlowTarget | null;
