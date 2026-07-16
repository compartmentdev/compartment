export function parseInstallHttpOrigin(value: string, errorMessage: string): URL {
  try {
    const parsedUrl: URL = new URL(value);
    if (
      (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') ||
      parsedUrl.username !== '' ||
      parsedUrl.password !== '' ||
      (parsedUrl.pathname !== '' && parsedUrl.pathname !== '/') ||
      parsedUrl.search !== '' ||
      parsedUrl.hash !== ''
    ) {
      throw new Error();
    }
    return parsedUrl;
  } catch {
    throw new Error(errorMessage);
  }
}
