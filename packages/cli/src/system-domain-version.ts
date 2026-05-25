export function resolveExpectedSystemDomainVersion(expectedVersion: number | undefined, activeVersion: number): number {
  assertExpectedActiveVersion(expectedVersion, activeVersion);
  return expectedVersion ?? activeVersion;
}

function assertExpectedActiveVersion(expectedVersion: number | undefined, activeVersion: number): void {
  if (expectedVersion === undefined || expectedVersion === activeVersion) {
    return;
  }

  throw new Error(
    `Expected setup version ${expectedVersion.toString()}, but current version is ${activeVersion.toString()}.`,
  );
}
