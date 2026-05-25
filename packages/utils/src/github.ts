export function buildGitHubApiBaseUrl(providerHost: string): string {
  return providerHost === 'github.com' ? 'https://api.github.com' : `https://${providerHost}/api/v3`;
}
