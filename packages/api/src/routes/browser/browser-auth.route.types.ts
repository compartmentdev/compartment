import type { BrowserFlowFields } from './browser-flow.types';

export interface BrowserAuthTokenQuery extends BrowserFlowFields {
  email?: string | undefined;
  token?: string | undefined;
}
