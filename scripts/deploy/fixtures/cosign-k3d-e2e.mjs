#!/usr/bin/env node

const imageRef = process.argv.at(-1);

if (process.argv[2] !== 'verify' || imageRef === undefined) {
  process.stderr.write('The k3d cosign fixture requires a verify command and image reference.\n');
  process.exit(1);
}

const digest = imageRef.includes('@') ? imageRef.split('@').at(1) : await resolveK3dTagDigest(imageRef);
if (digest === undefined || !/^sha256:[a-f0-9]{64}$/u.test(digest)) {
  process.stderr.write('The k3d cosign fixture could not resolve a sha256 digest for ' + imageRef + '.\n');
  process.exit(1);
}

process.stdout.write(
  `${JSON.stringify([
    {
      critical: {
        image: { 'docker-manifest-digest': digest },
        type: 'https://sigstore.dev/cosign/sign/v1',
      },
    },
  ])}\n`,
);

async function resolveK3dTagDigest(ref) {
  const repositorySeparator = ref.indexOf('/');
  const tagSeparator = ref.lastIndexOf(':');
  if (repositorySeparator === -1 || tagSeparator < repositorySeparator) {
    return undefined;
  }
  const registry = ref.slice(0, repositorySeparator);
  const registryMatch = registry.match(/^k3d-[a-z0-9.-]+:([0-9]+)$/u);
  if (registryMatch === null) {
    return undefined;
  }
  const repository = ref.slice(repositorySeparator + 1, tagSeparator);
  const tag = ref.slice(tagSeparator + 1);
  const response = await fetch(
    'http://localhost:' + registryMatch[1] + '/v2/' + repository + '/manifests/' + encodeURIComponent(tag),
    {
      headers: {
        accept:
          'application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json',
      },
    },
  );
  if (!response.ok) {
    return undefined;
  }
  return response.headers.get('docker-content-digest') ?? undefined;
}
