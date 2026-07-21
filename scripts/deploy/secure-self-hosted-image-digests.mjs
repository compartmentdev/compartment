const imageDigestPattern = /^sha256:[a-f0-9]{64}$/u;

export function assertImageDigest(digest) {
  if (!imageDigestPattern.test(digest)) {
    throw new Error(`Expected Docker image digest, received: ${digest}`);
  }
}

export function resolveScannedCanonicalDigest(input) {
  const { dockerhubDigest, ghcrDigest, imageName, scannedDigest } = input;
  assertImageDigest(scannedDigest);

  for (const existingDigest of [dockerhubDigest, ghcrDigest]) {
    if (existingDigest !== '') {
      assertImageDigest(existingDigest);
    }
  }

  if (dockerhubDigest !== '' && ghcrDigest !== '' && dockerhubDigest !== ghcrDigest) {
    throw new Error(
      `Immutable registries disagree for ${imageName}: Docker Hub has ${dockerhubDigest}, GHCR has ${ghcrDigest}.`,
    );
  }

  const unscannedDigest = [dockerhubDigest, ghcrDigest].find(
    (existingDigest) => existingDigest !== '' && existingDigest !== scannedDigest,
  );
  if (unscannedDigest !== undefined) {
    throw new Error(
      `Refusing to publish ${imageName}: immutable tag resolves to unscanned digest ${unscannedDigest}; this run scanned ${scannedDigest}.`,
    );
  }

  return scannedDigest;
}
