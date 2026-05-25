export type BrowserAppShellBundle = 'auth' | 'browser';

export interface BrowserAppShellPageInput {
  bundle: BrowserAppShellBundle;
  title: string;
}
