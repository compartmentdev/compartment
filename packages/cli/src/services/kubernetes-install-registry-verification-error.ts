const registryDnsFailurePattern: RegExp =
  /\b(?:lookup .* (?:no such host|server misbehaving)|temporary failure in name resolution|name resolution failed)\b/iu;

export class RegistryNodePullDnsError extends Error {}

export function createRegistryNodePullError(message: string, diagnostics: string): Error {
  return registryDnsFailurePattern.test(diagnostics) ? new RegistryNodePullDnsError(message) : new Error(message);
}
