/**
 * The credential is opaque to both sides: only `issueBuildSourceArchiveCredential` writes this payload and only
 * `verifyBuildSourceArchiveCredential` reads it, so it stays package-local rather than becoming a shared contract.
 * A second consumer, or a `version: 2` negotiation, makes it a wire shape that belongs in `contracts`.
 */
export interface BuildSourceArchiveCredentialPayload {
  artifactId: string;
  expiresAt: number;
  version: 1;
}
