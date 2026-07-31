import { gitProviderHostSchema } from '@compartment/contracts/browser';

export function readValidGitLabHost(input: string): string | null {
  const value: string = input.trim();
  let candidate: string = value.replace(/\/+$/u, '');
  if (value.includes('://')) {
    try {
      const url: URL = new URL(value);
      if (!isHostOnlyHttpUrl(url)) return null;
      candidate = url.host;
    } catch {
      return null;
    }
  }
  try {
    return gitProviderHostSchema.parse(candidate);
  } catch {
    return null;
  }
}

function isHostOnlyHttpUrl(url: URL): boolean {
  return (
    (url.protocol === 'https:' || url.protocol === 'http:') &&
    url.pathname === '/' &&
    url.search === '' &&
    url.hash === ''
  );
}
