import { createInvalidSsoLoginError } from '../../errors/api-business-error';

export function assertSafeBrowserSsoRedirectUrl(value: string): void {
  try {
    const url: URL = new URL(value);
    if (url.protocol === 'https:' && url.username === '' && url.password === '') {
      return;
    }
  } catch {
    throw createInvalidSsoLoginError();
  }

  throw createInvalidSsoLoginError();
}
