import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import selfHostedRuntimeImageSignaturePolicy from '../../packages/contracts/src/contracts/self-hosted-runtime-image-signature-policy.json' with { type: 'json' };
import {
  buildDigestImageRef,
  buildSelfHostedImageSbomPath,
  readSecureSelfHostedImageOptions,
  readSelfHostedImageRefsFromEnvFile,
  scanSelfHostedImages,
  secureSelfHostedImages,
} from './secure-self-hosted-images.mjs';

const testDigest = `sha256:${'a'.repeat(64)}`;

describe('readSecureSelfHostedImageOptions', () => {
  it('reads unique tags and output directory', () => {
    expect(readSecureSelfHostedImageOptions(['--output-dir', './sboms', 'sha-123', 'main', 'main'])).toEqual({
      dockerScout: false,
      envFilePath: undefined,
      outputDirectory: './sboms',
      repositoryPrefix: 'ghcr.io/compartmentdev',
      scanOnly: false,
      tags: ['sha-123', 'main'],
      validateProvenanceAttestation: false,
    });
  });

  it('reads scan-only mode', () => {
    expect(readSecureSelfHostedImageOptions(['--scan-only', 'sha-123'])).toEqual({
      dockerScout: false,
      envFilePath: undefined,
      outputDirectory: './.compartment/release-assets/self-hosted-sboms',
      repositoryPrefix: 'ghcr.io/compartmentdev',
      scanOnly: true,
      tags: ['sha-123'],
      validateProvenanceAttestation: false,
    });
  });

  it('reads provenance attestation validation mode', () => {
    expect(readSecureSelfHostedImageOptions(['--validate-provenance-attestation'])).toEqual({
      dockerScout: false,
      envFilePath: undefined,
      outputDirectory: './.compartment/release-assets/self-hosted-sboms',
      repositoryPrefix: 'ghcr.io/compartmentdev',
      scanOnly: false,
      tags: [],
      validateProvenanceAttestation: true,
    });
  });

  it('reads repository prefix overrides', () => {
    expect(
      readSecureSelfHostedImageOptions(['--repository-prefix', 'docker.io/compartmentdev', 'sha-123']),
    ).toMatchObject({
      dockerScout: false,
      repositoryPrefix: 'docker.io/compartmentdev',
      tags: ['sha-123'],
    });
  });

  it('reads Docker Scout scan mode', () => {
    expect(readSecureSelfHostedImageOptions(['--scan-only', '--docker-scout', 'sha-123'])).toMatchObject({
      dockerScout: true,
      scanOnly: true,
      tags: ['sha-123'],
    });
  });

  it('reads scan-only env file mode', () => {
    expect(readSecureSelfHostedImageOptions(['--scan-only', '--docker-scout', '--env-file', './cache.env'])).toEqual({
      dockerScout: true,
      envFilePath: './cache.env',
      outputDirectory: './.compartment/release-assets/self-hosted-sboms',
      repositoryPrefix: 'ghcr.io/compartmentdev',
      scanOnly: true,
      tags: [],
      validateProvenanceAttestation: false,
    });
  });

  it('requires at least one image tag', () => {
    expect(() => readSecureSelfHostedImageOptions([])).toThrow(
      'Expected at least one self-hosted image tag or --env-file.',
    );
  });

  it('requires scan-only mode for Docker Scout', () => {
    expect(() => readSecureSelfHostedImageOptions(['--docker-scout', 'sha-123'])).toThrow(
      'Can only use --docker-scout with --scan-only.',
    );
  });

  it('requires env file mode to be a single scan source', () => {
    expect(() => readSecureSelfHostedImageOptions(['--env-file', './cache.env'])).toThrow(
      'Can only use --env-file with --scan-only.',
    );
    expect(() =>
      readSecureSelfHostedImageOptions([
        '--scan-only',
        '--env-file',
        './cache.env',
        '--repository-prefix',
        'docker.io/x',
      ]),
    ).toThrow('Cannot combine --env-file with --repository-prefix.');
    expect(() => readSecureSelfHostedImageOptions(['--scan-only', '--env-file', './cache.env', 'sha-123'])).toThrow(
      'Cannot combine --env-file with image tags.',
    );
  });
});

describe('buildDigestImageRef', () => {
  it('replaces a tag with a digest', () => {
    expect(buildDigestImageRef('ghcr.io/compartmentdev/compartment-api:sha-123', testDigest)).toBe(
      `ghcr.io/compartmentdev/compartment-api@${testDigest}`,
    );
  });

  it('rejects invalid digests', () => {
    expect(() => buildDigestImageRef('ghcr.io/compartmentdev/compartment-api:sha-123', 'sha256:broken')).toThrow(
      'Expected Docker image digest',
    );
  });
});

describe('buildSelfHostedImageSbomPath', () => {
  it('uses the image name and digest in the SBOM file name', () => {
    expect(buildSelfHostedImageSbomPath('/tmp/sboms', `ghcr.io/compartmentdev/compartment-worker@${testDigest}`)).toBe(
      `/tmp/sboms/compartment-worker-sha256-${'a'.repeat(64)}.spdx.json`,
    );
  });
});

describe('scanSelfHostedImages', () => {
  it('scans self-hosted image refs from the rendered env file', async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), 'compartment-env-image-refs-test-'));
    const envFilePath = join(tempDirectory, '.env.self-hosted');
    const oldPath = process.env.PATH;
    const oldDockerScoutArgsLog = process.env.DOCKER_SCOUT_ARGS_LOG;
    const oldTrivyArgsLog = process.env.TRIVY_ARGS_LOG;

    try {
      const scannerPaths = await installFakeImageScanners(tempDirectory);
      const expectedImageRefs = [
        'localhost:5000/custom-api:from-env',
        'localhost:5000/custom-caddy:from-env',
        'localhost:5000/custom-edge:from-env',
        'localhost:5000/custom-worker:from-env',
        'localhost:5000/custom-runtime-probe:from-env',
      ];

      await writeFile(envFilePath, renderSelfHostedImageRefsEnv(), 'utf8');

      process.env.PATH = `${tempDirectory}:${oldPath ?? ''}`;
      process.env.DOCKER_SCOUT_ARGS_LOG = scannerPaths.dockerScoutArgsLogPath;
      process.env.TRIVY_ARGS_LOG = scannerPaths.trivyArgsLogPath;

      const imageRefs = readSelfHostedImageRefsFromEnvFile(tempDirectory, envFilePath);
      scanSelfHostedImages({ dockerScout: true, imageRefs, repositoryRoot: tempDirectory });

      const trivyCalls = parseCommandArgsLog(await readFile(scannerPaths.trivyArgsLogPath, 'utf8'));
      expect(trivyCalls.map((args) => args.at(-1))).toEqual(expectedImageRefs);
      const dockerScoutCalls = parseCommandArgsLog(await readFile(scannerPaths.dockerScoutArgsLogPath, 'utf8'));
      expect(dockerScoutCalls.map((args) => args.at(-1))).toEqual(expectedImageRefs);
    } finally {
      restoreEnv('PATH', oldPath);
      restoreEnv('DOCKER_SCOUT_ARGS_LOG', oldDockerScoutArgsLog);
      restoreEnv('TRIVY_ARGS_LOG', oldTrivyArgsLog);
      await rm(tempDirectory, { force: true, recursive: true });
    }
  });

  it('scans every self-hosted image before reporting failures', async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), 'compartment-trivy-test-'));
    const oldPath = process.env.PATH;
    const oldDockerScoutArgsLog = process.env.DOCKER_SCOUT_ARGS_LOG;
    const oldTrivyArgsLog = process.env.TRIVY_ARGS_LOG;
    const oldGitHubStepSummary = process.env.GITHUB_STEP_SUMMARY;

    try {
      const scannerPaths = await installFakeImageScanners(tempDirectory);
      const stepSummaryPath = join(tempDirectory, 'step-summary.md');

      process.env.PATH = `${tempDirectory}:${oldPath ?? ''}`;
      process.env.DOCKER_SCOUT_ARGS_LOG = scannerPaths.dockerScoutArgsLogPath;
      process.env.TRIVY_ARGS_LOG = scannerPaths.trivyArgsLogPath;
      process.env.GITHUB_STEP_SUMMARY = stepSummaryPath;

      let scanError;
      try {
        scanSelfHostedImages({ dockerScout: true, repositoryRoot: tempDirectory, tags: ['sha-test'] });
      } catch (error) {
        scanError = error;
      }

      expect(scanError).toBeInstanceOf(Error);
      expect(scanError.message).toContain(
        'Trivy failed the fixable HIGH/CRITICAL vulnerability gate for 1 self-hosted image(s):',
      );
      expect(scanError.message).toContain(
        'Docker Scout failed the fixable HIGH/CRITICAL vulnerability gate for 1 self-hosted image(s):',
      );

      const trivyCalls = parseCommandArgsLog(await readFile(scannerPaths.trivyArgsLogPath, 'utf8'));
      expect(trivyCalls.map((args) => args.at(-1))).toEqual(renderExpectedScannedImageRefs());
      const dockerScoutCalls = parseCommandArgsLog(await readFile(scannerPaths.dockerScoutArgsLogPath, 'utf8'));
      expect(dockerScoutCalls.map((args) => args.at(-1))).toEqual(renderExpectedScannedImageRefs());
      await expect(readFile(stepSummaryPath, 'utf8')).resolves.toContain(
        'Trivy failed the fixable HIGH/CRITICAL vulnerability gate for 1 self-hosted image(s).',
      );
      await expect(readFile(stepSummaryPath, 'utf8')).resolves.toContain(
        '`ghcr.io/compartmentdev/compartment-worker:sha-test`',
      );
      await expect(readFile(stepSummaryPath, 'utf8')).resolves.toContain(
        'Docker Scout failed the fixable HIGH/CRITICAL vulnerability gate for 1 self-hosted image(s).',
      );
      await expect(readFile(stepSummaryPath, 'utf8')).resolves.toContain(
        '`ghcr.io/compartmentdev/compartment-caddy:sha-test`',
      );
    } finally {
      restoreEnv('PATH', oldPath);
      restoreEnv('DOCKER_SCOUT_ARGS_LOG', oldDockerScoutArgsLog);
      restoreEnv('TRIVY_ARGS_LOG', oldTrivyArgsLog);
      restoreEnv('GITHUB_STEP_SUMMARY', oldGitHubStepSummary);
      await rm(tempDirectory, { force: true, recursive: true });
    }
  });
});

function renderSelfHostedImageRefsEnv() {
  return `COMPARTMENT_API_IMAGE=localhost:5000/custom-api:from-env
COMPARTMENT_CADDY_IMAGE=localhost:5000/custom-caddy:from-env
COMPARTMENT_EDGE_IMAGE=localhost:5000/custom-edge:from-env
COMPARTMENT_WORKER_IMAGE=localhost:5000/custom-worker:from-env
COMPARTMENT_RUNTIME_PROBE_IMAGE=localhost:5000/custom-runtime-probe:from-env
`;
}

async function installFakeImageScanners(tempDirectory) {
  const dockerPath = join(tempDirectory, 'docker');
  const dockerScoutArgsLogPath = join(tempDirectory, 'docker-scout-args.log');
  const trivyPath = join(tempDirectory, 'trivy');
  const trivyArgsLogPath = join(tempDirectory, 'trivy-args.log');

  await writeFile(dockerPath, renderFakeDockerScoutScript(), 'utf8');
  await writeFile(trivyPath, renderFakeTrivyScript(), 'utf8');
  await chmod(dockerPath, 0o755);
  await chmod(trivyPath, 0o755);

  return {
    dockerScoutArgsLogPath,
    trivyArgsLogPath,
  };
}

describe('secureSelfHostedImages', () => {
  it('writes SBOM and provenance files and signs both attestations', async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), 'compartment-secure-images-test-'));
    const oldEnvironment = readTestEnvironment();

    try {
      const outputDirectory = join(tempDirectory, 'sboms');
      const commandArgsLogPath = join(tempDirectory, 'command-args.log');

      await writeFile(join(tempDirectory, 'docker'), renderFakeDockerScript(), 'utf8');
      await writeFile(join(tempDirectory, 'trivy'), renderFakeSecureTrivyScript(), 'utf8');
      await writeFile(join(tempDirectory, 'cosign'), renderFakeCosignScript(), 'utf8');
      await chmod(join(tempDirectory, 'docker'), 0o755);
      await chmod(join(tempDirectory, 'trivy'), 0o755);
      await chmod(join(tempDirectory, 'cosign'), 0o755);

      process.env.PATH = `${tempDirectory}:${oldEnvironment.PATH ?? ''}`;
      process.env.COMMAND_ARGS_LOG = commandArgsLogPath;
      process.env.GITHUB_REF = 'refs/heads/main';
      process.env.GITHUB_REPOSITORY = 'compartmentdev/compartment';
      process.env.GITHUB_RUN_ATTEMPT = '2';
      process.env.GITHUB_RUN_ID = '123456';
      process.env.GITHUB_SERVER_URL = 'https://github.com';
      process.env.GITHUB_SHA = 'abc123';
      process.env.GITHUB_WORKFLOW = 'Publish Self-Hosted Images (Main)';
      delete process.env.GITHUB_WORKFLOW_REF;

      await secureSelfHostedImages({
        outputDirectory,
        repositoryRoot: tempDirectory,
        tags: ['sha-test'],
      });

      const provenanceText = await readFile(
        join(outputDirectory, `compartment-api-sha256-${'a'.repeat(64)}.slsa-v1-provenance.json`),
        'utf8',
      );
      const provenance = JSON.parse(provenanceText);
      expect(provenance).toMatchObject({
        buildDefinition: {
          buildType: 'https://github.com/compartmentdev/compartment',
          externalParameters: {
            repository: 'compartmentdev/compartment',
            service: 'api',
          },
        },
        runDetails: {
          builder: {
            id: 'https://github.com/compartmentdev/compartment/actions/runs/123456/attempts/2',
          },
        },
      });
      await expect(
        readFile(join(outputDirectory, `compartment-api-sha256-${'a'.repeat(64)}.spdx.json`), 'utf8'),
      ).resolves.toContain('"SPDXID"');

      const cosignCalls = parseCommandArgsLog(await readFile(commandArgsLogPath, 'utf8')).filter(
        (entry) => entry.file === 'cosign',
      );
      const mainImageDigestRef = `ghcr.io/compartmentdev/compartment-api@sha256:${'a'.repeat(64)}`;
      const runtimeProbeDigestRef = `ghcr.io/compartmentdev/compartment-runtime-probe@sha256:${'e'.repeat(64)}`;
      const expectedBundleFormatFlag = selfHostedRuntimeImageSignaturePolicy.cosignBundleFormatFlag;

      expect(hasCosignCall(cosignCalls, ['sign', '--yes', expectedBundleFormatFlag, mainImageDigestRef])).toBe(true);
      expect(hasCosignCall(cosignCalls, ['sign', '--yes', expectedBundleFormatFlag, runtimeProbeDigestRef])).toBe(true);
      expect(hasCosignCall(cosignCalls, ['attest', '--yes', expectedBundleFormatFlag, '--type', 'spdxjson'])).toBe(
        true,
      );
      expect(
        hasCosignCall(cosignCalls, ['attest', '--yes', expectedBundleFormatFlag, '--type', 'slsaprovenance1']),
      ).toBe(true);
      const provenanceCall = readCosignProvenanceAttestationCall(cosignCalls);
      expect(readCosignProvenanceAttestationType(cosignCalls)).toBe('slsaprovenance1');
      expect(provenanceCall).toBeDefined();

      expect(
        cosignCalls.some((entry) => entry.args[0] === 'attest' && entry.args.includes(runtimeProbeDigestRef)),
      ).toBe(true);
      expect(
        hasCosignCall(cosignCalls, [
          'verify',
          expectedBundleFormatFlag,
          '--certificate-oidc-issuer',
          selfHostedRuntimeImageSignaturePolicy.certificateOidcIssuer,
          '--certificate-identity-regexp',
          selfHostedRuntimeImageSignaturePolicy.certificateIdentityRegexp,
          runtimeProbeDigestRef,
        ]),
      ).toBe(true);
    } finally {
      restoreTestEnvironment(oldEnvironment);
      await rm(tempDirectory, { force: true, recursive: true });
    }
  });
});

function hasCosignCall(cosignCalls, expectedArgs) {
  return cosignCalls.some((entry) => expectedArgs.every((value, index) => entry.args[index] === value));
}

function renderFakeTrivyScript() {
  return `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';

const imageRef = process.argv.at(-1) ?? '';
appendFileSync(process.env.TRIVY_ARGS_LOG, \`\${JSON.stringify(process.argv.slice(2))}\\n\`);

if (imageRef.includes('compartment-worker')) {
  process.exit(1);
}
`;
}

function renderFakeDockerScoutScript() {
  return `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';

const imageRef = process.argv.at(-1) ?? '';
appendFileSync(process.env.DOCKER_SCOUT_ARGS_LOG, \`\${JSON.stringify(process.argv.slice(2))}\\n\`);

if (imageRef.includes('compartment-caddy')) {
  process.exit(2);
}
`;
}

function renderFakeDockerScript() {
  return `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';

appendFileSync(process.env.COMMAND_ARGS_LOG, JSON.stringify({ file: 'docker', args: process.argv.slice(2) }) + '\\n');
const imageRef = process.argv.at(-1) ?? '';
const service = imageRef.match(/compartment-([a-z-]+):/)?.[1] ?? 'api';
const digestByService = { api: '${'a'.repeat(64)}', caddy: '${'b'.repeat(64)}', edge: '${'c'.repeat(64)}', worker: '${'d'.repeat(64)}', 'runtime-probe': '${'e'.repeat(64)}' };
process.stdout.write('sha256:' + digestByService[service]);
`;
}

function renderFakeSecureTrivyScript() {
  return `#!/usr/bin/env node
import { appendFileSync, writeFileSync } from 'node:fs';

appendFileSync(process.env.COMMAND_ARGS_LOG, JSON.stringify({ file: 'trivy', args: process.argv.slice(2) }) + '\\n');
const outputIndex = process.argv.indexOf('--output');
if (outputIndex !== -1) {
  writeFileSync(process.argv[outputIndex + 1], JSON.stringify({ SPDXID: 'SPDXRef-DOCUMENT' }) + '\\n');
}
`;
}

function renderFakeCosignScript() {
  return `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';

appendFileSync(process.env.COMMAND_ARGS_LOG, JSON.stringify({ file: 'cosign', args: process.argv.slice(2) }) + '\\n');
`;
}

function renderExpectedScannedImageRefs() {
  return [
    'ghcr.io/compartmentdev/compartment-api:sha-test',
    'ghcr.io/compartmentdev/compartment-caddy:sha-test',
    'ghcr.io/compartmentdev/compartment-edge:sha-test',
    'ghcr.io/compartmentdev/compartment-worker:sha-test',
    'ghcr.io/compartmentdev/compartment-runtime-probe:sha-test',
  ];
}

function parseCommandArgsLog(value) {
  return value
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}

function readCosignProvenanceAttestationType(cosignCalls) {
  const provenanceCall = readCosignProvenanceAttestationCall(cosignCalls);
  const typeIndex = provenanceCall?.args.indexOf('--type') ?? -1;
  return typeIndex === -1 ? undefined : provenanceCall?.args[typeIndex + 1];
}

function readCosignProvenanceAttestationCall(cosignCalls) {
  return cosignCalls.find(
    (entry) =>
      entry.args[0] === 'attest' &&
      entry.args[entry.args.indexOf('--predicate') + 1]?.endsWith('.slsa-v1-provenance.json'),
  );
}

function readTestEnvironment() {
  return {
    COMMAND_ARGS_LOG: process.env.COMMAND_ARGS_LOG,
    GITHUB_REF: process.env.GITHUB_REF,
    GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY,
    GITHUB_RUN_ATTEMPT: process.env.GITHUB_RUN_ATTEMPT,
    GITHUB_RUN_ID: process.env.GITHUB_RUN_ID,
    GITHUB_SERVER_URL: process.env.GITHUB_SERVER_URL,
    GITHUB_SHA: process.env.GITHUB_SHA,
    GITHUB_WORKFLOW: process.env.GITHUB_WORKFLOW,
    GITHUB_WORKFLOW_REF: process.env.GITHUB_WORKFLOW_REF,
    PATH: process.env.PATH,
  };
}

function restoreTestEnvironment(environment) {
  for (const [name, value] of Object.entries(environment)) {
    restoreEnv(name, value);
  }
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
