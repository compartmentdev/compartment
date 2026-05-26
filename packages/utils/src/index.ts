export { hasText, readCookieValue } from './browser';
export {
  buildCliInstallLoginCommand,
  readCliInstallLoginApiUrl,
  type CliInstallLoginCommandInput,
} from './cli-install-login-command';
export { assertHttpHeaderName, assertHttpHeaderValue, readBearerToken, readHeaderValue } from './http-header';
export { parseHttpHostAuthority } from './http-host-authority';
export { serializeCookie } from './http-cookie';
export { buildGitHubApiBaseUrl } from './github';
export { buildInternalHttpUrl } from './internal-http-url';
export { normalizeNanosecondZuluTimestamp } from './log-timestamp';
export { normalizeDnsHostname } from './dns-hostname';
export { appendOptionalSearchParam, hasDuplicateSearchParam, readSingleSearchParam, readUrlOrigin } from './url';
export { buildCompartmentArtifactRegistryAddress } from './artifact-registry-address';
export { isUnsafePublicIpAddress } from './public-ip';
export { createOutboundHttpFetch, fetchOutboundHttp } from './outbound-http/outbound-http-client';
export { normalizeOutboundTrustedHost } from './outbound-http/outbound-http-policy';
export { type OutboundHttpResource } from './outbound-http/outbound-http-client.types';
export { parseOptionalTrustedOutboundHostList } from './trusted-outbound-host';
export { isSafeRelativePath, sanitizeSafeRelativePath } from './safe-relative-path';
export { quoteShellArgument, quoteShellArgumentWhenNeeded } from './shell-argument';
export {
  buildPendingSystemDomainCertificatePaths,
  type PendingSystemDomainCertificatePaths,
} from './system-domain-certificate-paths';
export {
  validateSymlinkFreeFileSystemDirectory,
  validateSymlinkFreeFileSystemEntry,
  validateSymlinkFreeFileSystemWriteTarget,
  type FileSystemEntryKind,
  type ValidatedFileSystemEntry,
  type ValidatedFileSystemWriteTarget,
} from './file-system-boundary';
export { isMissingFileSystemEntryError, isPathWithinDirectory, readRequiredAbsolutePath } from './file-system-path';
export {
  assertValidUnixSocketPath,
  createCompartmentUnixSocketPathPolicy,
  prepareUnixSocketPath,
  restrictUnixSocketPathPermissions,
  type UnixSocketPathPolicy,
} from './unix-socket-path';
export { type JsonValue } from './json';
export { isValidEmailAddress, readNonEmptyLines, slugifyText } from './text';
