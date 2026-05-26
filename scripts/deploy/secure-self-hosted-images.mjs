import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

import { captureCommand, runCommand } from '../lib/command.mjs';
import { readRequiredOptionValue } from '../lib/options.mjs';
import { readRepositoryRoot } from '../lib/repository-root.mjs';
import {
  buildSelfHostedImageRefForRepository,
  selfHostedImageRepositoryPrefixes,
  selfHostedRuntimeImageArtifacts,
} from './self-hosted-runtime-services.mjs';

const defaultOutputDirectory = './.compartment/release-assets/self-hosted-sboms';
const defaultRepositoryPrefix = selfHostedImageRepositoryPrefixes[0];
const imageDigestPattern = /^sha256:[a-f0-9]{64}$/u;
const slsaProvenanceV1FileSuffix = '.slsa-v1-provenance.json';
const slsaProvenanceV1AttestationType = 'slsaprovenance1';
const transientCosignBundleRegistryErrorMessage = 'no valid bundles exist in registry';
const cosignVerifyRetryDelaysMs = Object.freeze([1_000, 2_000, 4_000, 8_000, 16_000, 32_000]);
const validationDigestRef = `docker.io/compartmentdev/compartment-api@sha256:${'a'.repeat(64)}`;
const repositoryRoot = readRepositoryRoot(import.meta.url, 2);
const selfHostedRuntimeImageSignaturePolicy = readSelfHostedRuntimeImageSignaturePolicy(repositoryRoot);
const trivyIgnorefile = '.trivyignore.yaml';

async function main() {
  const options = readSecureSelfHostedImageOptions(process.argv.slice(2));
  if (options.validateProvenanceAttestation) {
    validateSelfHostedImageProvenanceAttestation(repositoryRoot);
    return;
  }

  if (options.scanOnly) {
    scanSelfHostedImages({
      dockerScout: options.dockerScout,
      repositoryPrefix: options.repositoryPrefix,
      repositoryRoot,
      tags: options.tags,
    });
    return;
  }

  await secureSelfHostedImages({
    outputDirectory: options.outputDirectory,
    repositoryPrefix: options.repositoryPrefix,
    repositoryRoot,
    tags: options.tags,
  });
}

export async function secureSelfHostedImages(input) {
  const outputDirectory = resolveOutputDirectory(input.repositoryRoot, input.outputDirectory);
  await mkdir(outputDirectory, { recursive: true });

  const securedDigestRefs = new Set();

  for (const serviceName of selfHostedRuntimeImageArtifacts) {
    for (const tag of input.tags) {
      const imageRef = buildSecureSelfHostedImageRef(input.repositoryPrefix, serviceName, tag);
      const digestRef = readSelfHostedImageDigestRef(input.repositoryRoot, imageRef);

      if (securedDigestRefs.has(digestRef)) {
        process.stdout.write(`Skipping already secured self-hosted image digest ${digestRef} from ${imageRef}.\n`);
        continue;
      }

      const sbomPath = buildSelfHostedImageSbomPath(outputDirectory, digestRef);
      const provenancePath = buildSelfHostedImageProvenancePath(outputDirectory, digestRef);
      process.stdout.write(`Securing self-hosted image ${digestRef} from ${imageRef}.\n`);
      writeSelfHostedImageSbom(input.repositoryRoot, digestRef, sbomPath);
      writeSelfHostedImageProvenance(digestRef, serviceName, provenancePath);
      signSelfHostedImage(input.repositoryRoot, digestRef);
      await verifySelfHostedImageSignature(input.repositoryRoot, digestRef);
      attestSelfHostedImageSbom(input.repositoryRoot, digestRef, sbomPath);
      attestSelfHostedImageProvenance(input.repositoryRoot, digestRef, provenancePath);
      securedDigestRefs.add(digestRef);
    }
  }
}

export function scanSelfHostedImages(input) {
  const dockerScoutFailedImageRefs = [];
  const scannedImageRefs = new Set();
  const trivyFailedImageRefs = [];

  for (const serviceName of selfHostedRuntimeImageArtifacts) {
    for (const tag of input.tags) {
      const imageRef = buildSecureSelfHostedImageRef(input.repositoryPrefix, serviceName, tag);

      if (scannedImageRefs.has(imageRef)) {
        continue;
      }

      process.stdout.write(`Scanning self-hosted image ${imageRef}.\n`);
      try {
        scanSelfHostedImage(input.repositoryRoot, imageRef);
      } catch (error) {
        trivyFailedImageRefs.push(imageRef);
        process.stderr.write(`Trivy scan failed for self-hosted image ${imageRef}: ${readErrorMessage(error)}\n`);
      }

      if (input.dockerScout === true) {
        process.stdout.write(`Checking fixable self-hosted image vulnerabilities with Docker Scout for ${imageRef}.\n`);
        try {
          scanSelfHostedImageWithDockerScout(input.repositoryRoot, imageRef);
        } catch (error) {
          dockerScoutFailedImageRefs.push(imageRef);
          process.stderr.write(
            `Docker Scout scan failed for self-hosted image ${imageRef}: ${readErrorMessage(error)}\n`,
          );
        }
      }
      scannedImageRefs.add(imageRef);
    }
  }

  reportSelfHostedImageScanFailures({
    dockerScoutFailedImageRefs,
    trivyFailedImageRefs,
  });
}

export function readSecureSelfHostedImageOptions(args) {
  let dockerScout = false;
  const tags = [];
  let outputDirectory = defaultOutputDirectory;
  let repositoryPrefix = defaultRepositoryPrefix;
  let scanOnly = false;
  let validateProvenanceAttestation = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === '--scan-only') {
      scanOnly = true;
      continue;
    }

    if (argument === '--docker-scout') {
      dockerScout = true;
      continue;
    }

    if (argument === '--validate-provenance-attestation') {
      validateProvenanceAttestation = true;
      continue;
    }

    if (argument === '--output-dir') {
      outputDirectory = readRequiredOptionValue(args, index + 1, '--output-dir');
      index += 1;
      continue;
    }

    if (argument === '--repository-prefix') {
      repositoryPrefix = readRequiredOptionValue(args, index + 1, '--repository-prefix');
      index += 1;
      continue;
    }

    if (argument.startsWith('--')) {
      throw new Error(`Unknown option: ${argument}`);
    }

    const tag = argument.trim();
    if (tag !== '') {
      tags.push(tag);
    }
  }

  if (validateProvenanceAttestation && scanOnly) {
    throw new Error('Cannot combine --validate-provenance-attestation with --scan-only.');
  }

  if (dockerScout && !scanOnly) {
    throw new Error('Can only use --docker-scout with --scan-only.');
  }

  if (validateProvenanceAttestation && tags.length !== 0) {
    throw new Error('Expected no image tags with --validate-provenance-attestation.');
  }

  if (!validateProvenanceAttestation && tags.length === 0) {
    throw new Error(
      'Expected at least one self-hosted image tag. Example: `node ./scripts/deploy/secure-self-hosted-images.mjs sha-<commit> main`.',
    );
  }

  return {
    dockerScout,
    outputDirectory,
    repositoryPrefix,
    scanOnly,
    tags: [...new Set(tags)],
    validateProvenanceAttestation,
  };
}

function buildSecureSelfHostedImageRef(repositoryPrefix, serviceName, tag) {
  return buildSelfHostedImageRefForRepository(serviceName, tag, repositoryPrefix ?? defaultRepositoryPrefix);
}

export function buildDigestImageRef(imageRef, digest) {
  if (!imageDigestPattern.test(digest)) {
    throw new Error(`Expected Docker image digest, received: ${digest}`);
  }

  const tagSeparatorIndex = imageRef.lastIndexOf(':');
  const pathSeparatorIndex = imageRef.lastIndexOf('/');
  if (tagSeparatorIndex <= pathSeparatorIndex) {
    throw new Error(`Expected tagged Docker image ref, received: ${imageRef}`);
  }

  return `${imageRef.slice(0, tagSeparatorIndex)}@${digest}`;
}

export function buildSelfHostedImageSbomPath(outputDirectory, digestRef) {
  const filename = digestRef
    .slice(digestRef.lastIndexOf('/') + 1)
    .replace('@sha256:', '-sha256-')
    .replace(/[^a-zA-Z0-9_.-]/gu, '-');

  return resolve(outputDirectory, `${filename}.spdx.json`);
}

function buildSelfHostedImageProvenancePath(outputDirectory, digestRef) {
  const filename = digestRef
    .slice(digestRef.lastIndexOf('/') + 1)
    .replace('@sha256:', '-sha256-')
    .replace(/[^a-zA-Z0-9_.-]/gu, '-');

  return resolve(outputDirectory, `${filename}${slsaProvenanceV1FileSuffix}`);
}

function buildSelfHostedImageProvenancePredicate(digestRef, serviceName, env = process.env) {
  const repository = readOptionalGitHubEnvironmentValue(env, 'GITHUB_REPOSITORY') ?? 'compartmentdev/compartment';
  const serverUrl = readOptionalGitHubEnvironmentValue(env, 'GITHUB_SERVER_URL') ?? 'https://github.com';
  const repositoryUri = `${serverUrl}/${repository}`;
  const workflowRef = readOptionalGitHubEnvironmentValue(env, 'GITHUB_WORKFLOW_REF');
  const workflowRefUri = workflowRef === undefined ? undefined : `${serverUrl}/${workflowRef}`;
  const commitSha = readOptionalGitHubEnvironmentValue(env, 'GITHUB_SHA');

  return {
    buildDefinition: {
      buildType: workflowRefUri ?? repositoryUri,
      externalParameters: dropUndefinedProperties({
        ref: readOptionalGitHubEnvironmentValue(env, 'GITHUB_REF'),
        repository,
        service: serviceName,
        sha: commitSha,
        workflow: readOptionalGitHubEnvironmentValue(env, 'GITHUB_WORKFLOW'),
        workflowRef,
      }),
      internalParameters: {
        digestRef,
      },
      resolvedDependencies:
        commitSha === undefined
          ? []
          : [
              {
                digest: {
                  gitCommit: commitSha,
                },
                uri: `git+${repositoryUri}`,
              },
            ],
    },
    runDetails: {
      builder: {
        id: readGitHubActionsRunUrl(env, repositoryUri),
      },
      metadata: dropUndefinedProperties({
        invocationId: readOptionalGitHubEnvironmentValue(env, 'GITHUB_RUN_ID'),
        startedOn: readOptionalGitHubEnvironmentValue(env, 'GITHUB_JOB_STARTED_AT'),
      }),
    },
  };
}

function resolveOutputDirectory(repositoryRoot, outputDirectory) {
  return isAbsolute(outputDirectory) ? outputDirectory : resolve(repositoryRoot, outputDirectory);
}

function readSelfHostedImageDigestRef(repositoryRoot, imageRef) {
  const digest = captureCommand(
    'docker',
    ['buildx', 'imagetools', 'inspect', '--format', '{{ printf "%s" .Manifest.Digest }}', imageRef],
    repositoryRoot,
  );
  return buildDigestImageRef(imageRef, digest);
}

function scanSelfHostedImage(repositoryRoot, imageRef) {
  runCommand(
    'trivy',
    [
      'image',
      '--no-progress',
      '--ignorefile',
      resolve(repositoryRoot, trivyIgnorefile),
      '--ignore-unfixed',
      '--scanners',
      'vuln',
      '--severity',
      'HIGH,CRITICAL',
      '--exit-code',
      '1',
      imageRef,
    ],
    repositoryRoot,
  );
}

function scanSelfHostedImageWithDockerScout(repositoryRoot, imageRef) {
  runCommand(
    'docker',
    ['scout', 'cves', '--only-fixed', '--only-severity', 'critical,high', '--exit-code', imageRef],
    repositoryRoot,
  );
}

function reportSelfHostedImageScanFailures(input) {
  if (input.trivyFailedImageRefs.length === 0 && input.dockerScoutFailedImageRefs.length === 0) {
    return;
  }

  const failureMessage = buildSelfHostedImageScanFailureMessage(input);
  writeSelfHostedImageScanFailureSummary(input);
  throw new Error(failureMessage);
}

function buildSelfHostedImageScanFailureMessage(input) {
  return [
    buildScannerFailureMessage('Trivy', input.trivyFailedImageRefs),
    buildScannerFailureMessage('Docker Scout', input.dockerScoutFailedImageRefs),
  ]
    .filter((message) => message !== null)
    .join('\n\n');
}

function buildScannerFailureMessage(scannerName, failedImageRefs) {
  if (failedImageRefs.length === 0) {
    return null;
  }

  const failureList = failedImageRefs.map((imageRef) => `- ${imageRef}`).join('\n');
  return `${scannerName} reported fixable HIGH/CRITICAL vulnerabilities in ${failedImageRefs.length} self-hosted image(s):\n${failureList}`;
}

function writeSelfHostedImageScanFailureSummary(input) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY?.trim();
  if (summaryPath === undefined || summaryPath === '') {
    return;
  }

  const summary = [
    buildScannerFailureSummary('Trivy', input.trivyFailedImageRefs),
    buildScannerFailureSummary('Docker Scout', input.dockerScoutFailedImageRefs),
  ]
    .filter((section) => section !== null)
    .join('\n\n');

  try {
    appendFileSync(summaryPath, `${summary}\n`, 'utf8');
  } catch (error) {
    process.stderr.write(`Failed to write image scan summary: ${readErrorMessage(error)}\n`);
  }
}

function buildScannerFailureSummary(scannerName, failedImageRefs) {
  if (failedImageRefs.length === 0) {
    return null;
  }

  const tableRows = failedImageRefs.map((imageRef) => `| \`${escapeMarkdownTableCell(imageRef)}\` |`).join('\n');
  const summary = `### ${scannerName} self-hosted image vulnerability scan

${scannerName} found fixable HIGH/CRITICAL vulnerabilities in ${failedImageRefs.length} self-hosted image(s).

| Image |
| --- |
${tableRows}
`;

  return summary;
}

function escapeMarkdownTableCell(value) {
  return value.replaceAll('|', '\\|');
}

function readErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function writeSelfHostedImageSbom(repositoryRoot, digestRef, sbomPath) {
  runCommand(
    'trivy',
    ['image', '--no-progress', '--format', 'spdx-json', '--output', sbomPath, digestRef],
    repositoryRoot,
  );
}

function writeSelfHostedImageProvenance(digestRef, serviceName, provenancePath) {
  writeFileSync(
    provenancePath,
    `${JSON.stringify(buildSelfHostedImageProvenancePredicate(digestRef, serviceName), null, 2)}\n`,
    'utf8',
  );
}

function validateSelfHostedImageProvenanceAttestation(repositoryRoot) {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'compartment-self-hosted-provenance-'));
  const cosignKeyPrefix = resolve(temporaryDirectory, 'cosign');
  const provenancePath = resolve(temporaryDirectory, `sample${slsaProvenanceV1FileSuffix}`);
  const cosignEnv = {
    ...process.env,
    COSIGN_PASSWORD: 'compartment-ci-provenance-check',
  };

  try {
    writeSelfHostedImageProvenance(validationDigestRef, 'api', provenancePath);
    runCommand('cosign', ['generate-key-pair', '--output-key-prefix', cosignKeyPrefix], repositoryRoot, cosignEnv);
    captureCommand(
      'cosign',
      [
        'attest',
        '--key',
        `${cosignKeyPrefix}.key`,
        '--tlog-upload=false',
        '--no-upload=true',
        '--type',
        slsaProvenanceV1AttestationType,
        '--predicate',
        provenancePath,
        validationDigestRef,
      ],
      repositoryRoot,
      cosignEnv,
    );
    process.stdout.write('Validated self-hosted SLSA v1 provenance attestation with cosign.\n');
  } finally {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

function signSelfHostedImage(repositoryRoot, digestRef) {
  runCommand(
    'cosign',
    ['sign', '--yes', selfHostedRuntimeImageSignaturePolicy.cosignBundleFormatFlag, digestRef],
    repositoryRoot,
  );
}

async function verifySelfHostedImageSignature(repositoryRoot, digestRef) {
  const args = buildSelfHostedImageSignatureVerifyArgs(digestRef);
  const maxVerifyAttempts = cosignVerifyRetryDelaysMs.length + 1;

  for (let attemptIndex = 0; attemptIndex < maxVerifyAttempts; attemptIndex += 1) {
    const verification = runCapturedCosignVerify(repositoryRoot, args);
    if (verification.ok) {
      writeCosignVerifyOutput(verification);
      return;
    }

    const retryDelayMs = cosignVerifyRetryDelaysMs[attemptIndex];
    if (!isTransientCosignBundleRegistryError(verification) || retryDelayMs === undefined) {
      writeCosignVerifyOutput(verification);
      throw new Error(`Command failed: ${['cosign', ...args].join(' ')}`);
    }

    process.stderr.write(
      `Cosign verify did not find registry bundles for ${digestRef}; retrying in ${retryDelayMs}ms.\n`,
    );
    await delay(retryDelayMs);
  }
}

function buildSelfHostedImageSignatureVerifyArgs(digestRef) {
  return [
    'verify',
    selfHostedRuntimeImageSignaturePolicy.cosignBundleFormatFlag,
    '--certificate-oidc-issuer',
    selfHostedRuntimeImageSignaturePolicy.certificateOidcIssuer,
    '--certificate-identity-regexp',
    selfHostedRuntimeImageSignaturePolicy.certificateIdentityRegexp,
    digestRef,
  ];
}

function runCapturedCosignVerify(repositoryRoot, args) {
  const result = spawnSync('cosign', args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error !== undefined) {
    throw result.error;
  }

  return {
    ok: result.status === 0,
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

function isTransientCosignBundleRegistryError(verification) {
  return `${verification.stdout}\n${verification.stderr}`.includes(transientCosignBundleRegistryErrorMessage);
}

function writeCosignVerifyOutput(verification) {
  process.stdout.write(verification.stdout);
  process.stderr.write(verification.stderr);
}

function attestSelfHostedImageSbom(repositoryRoot, digestRef, sbomPath) {
  runCommand(
    'cosign',
    [
      'attest',
      '--yes',
      selfHostedRuntimeImageSignaturePolicy.cosignBundleFormatFlag,
      '--type',
      'spdxjson',
      '--predicate',
      sbomPath,
      digestRef,
    ],
    repositoryRoot,
  );
}

function attestSelfHostedImageProvenance(repositoryRoot, digestRef, provenancePath) {
  runCommand(
    'cosign',
    [
      'attest',
      '--yes',
      selfHostedRuntimeImageSignaturePolicy.cosignBundleFormatFlag,
      '--type',
      slsaProvenanceV1AttestationType,
      '--predicate',
      provenancePath,
      digestRef,
    ],
    repositoryRoot,
  );
}

function readSelfHostedRuntimeImageSignaturePolicy(repositoryRoot) {
  const policyPath = resolve(
    repositoryRoot,
    'packages/contracts/src/contracts/self-hosted-runtime-image-signature-policy.json',
  );
  const parsedPolicy = JSON.parse(readFileSync(policyPath, 'utf8'));

  return {
    certificateIdentityRegexp: readRequiredPolicyString(parsedPolicy, 'certificateIdentityRegexp'),
    certificateOidcIssuer: readRequiredPolicyString(parsedPolicy, 'certificateOidcIssuer'),
    cosignBundleFormatFlag: readRequiredPolicyString(parsedPolicy, 'cosignBundleFormatFlag'),
  };
}

function readRequiredPolicyString(policy, key) {
  if (policy === null || typeof policy !== 'object' || Array.isArray(policy)) {
    throw new Error('Expected self-hosted runtime image signature policy to be an object.');
  }

  const value = policy[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Expected self-hosted runtime image signature policy string value for ${key}.`);
  }

  return value;
}

function readGitHubActionsRunUrl(env, repositoryUri) {
  const runId = readOptionalGitHubEnvironmentValue(env, 'GITHUB_RUN_ID');
  if (runId === undefined) {
    return repositoryUri;
  }

  const runAttempt = readOptionalGitHubEnvironmentValue(env, 'GITHUB_RUN_ATTEMPT');
  return `${repositoryUri}/actions/runs/${runId}${runAttempt === undefined ? '' : `/attempts/${runAttempt}`}`;
}

function readOptionalGitHubEnvironmentValue(env, name) {
  const value = env[name]?.trim();
  return value === undefined || value === '' ? undefined : value;
}

function dropUndefinedProperties(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entryValue]) => entryValue !== undefined));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
