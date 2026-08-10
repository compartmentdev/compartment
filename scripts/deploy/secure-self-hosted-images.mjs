import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { captureCommand, captureCommandResult, runCommand } from '../lib/command.mjs';
import { readRequiredOptionValue } from '../lib/options.mjs';
import { readRepositoryRoot } from '../lib/repository-root.mjs';
import { runMain } from '../lib/run-main.mjs';
import { assertImageDigest, resolveScannedCanonicalDigest } from './secure-self-hosted-image-digests.mjs';
import {
  buildSelfHostedImageRefForRepository,
  defaultSelfHostedImageRepositoryPrefix,
  selfHostedRuntimeImageArtifacts,
} from './self-hosted-runtime-services.mjs';

const defaultOutputDirectory = './.compartment/release-assets/self-hosted-sboms';
const defaultRepositoryPrefix = defaultSelfHostedImageRepositoryPrefix;
const slsaProvenanceV1FileSuffix = '.slsa-v1-provenance.json';
const slsaProvenanceV1AttestationType = 'slsaprovenance1';
const transientCosignBundleRegistryErrorMessage = 'no valid bundles exist in registry';
const cosignVerifyRetryDelaysMs = Object.freeze([1_000, 2_000, 4_000, 8_000, 16_000, 32_000]);
const trivySbomRegistryReadRetryDelaysMs = Object.freeze([1_000, 2_000, 4_000]);
const trivyRegistryReadDeniedMessage = 'DENIED: requested access to the resource is denied';
const validationDigestRef = `docker.io/compartmentdev/compartment-api@sha256:${'a'.repeat(64)}`;
const repositoryRoot = readRepositoryRoot(import.meta.url, 2);
const selfHostedRuntimeImageSignaturePolicy = readSelfHostedRuntimeImageSignaturePolicy(repositoryRoot);
const trivyIgnorefile = '.trivyignore.yaml';
const dockerScoutVexFile = '.scout-vex.openvex.json';

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--resolve-scanned-digest') {
    process.stdout.write(`${resolveScannedCanonicalDigest(readScannedDigestResolutionInput(args.slice(1)))}\n`);
    return;
  }
  if (args[0] === '--read-build-metadata-digest') {
    process.stdout.write(`${readBuildMetadataDigest(args.slice(1))}\n`);
    return;
  }

  const options = readSecureSelfHostedImageOptions(args);
  if (options.validateProvenanceAttestation) {
    validateSelfHostedImageProvenanceAttestation(repositoryRoot);
    return;
  }

  if (options.scanOnly) {
    scanSelfHostedImages({
      dockerScout: options.dockerScout,
      imageRefs: options.imageRefs,
      repositoryPrefix: options.repositoryPrefix,
      repositoryRoot,
      tags: options.tags,
    });
    return;
  }

  await secureSelfHostedImages({
    imageRefs: options.imageRefs,
    outputDirectory: options.outputDirectory,
    repositoryPrefix: options.repositoryPrefix,
    repositoryRoot,
    tags: options.tags,
  });
}

function readBuildMetadataDigest(args) {
  if (args.length !== 1) {
    throw new Error('Expected one metadata file path after --read-build-metadata-digest.');
  }

  const metadata = JSON.parse(readFileSync(resolve(repositoryRoot, args[0]), 'utf8'));
  const digest = metadata?.['containerimage.digest'];
  assertImageDigest(digest);
  return digest;
}

async function secureSelfHostedImages(input) {
  const outputDirectory = resolveOutputDirectory(input.repositoryRoot, input.outputDirectory);
  await mkdir(outputDirectory, { recursive: true });

  const securedDigestRefs = new Set();
  const imageTargets = buildSecureSelfHostedImageTargets(input);

  for (const { digestRef, imageRef, serviceName } of imageTargets) {
    if (securedDigestRefs.has(digestRef)) {
      process.stdout.write(`Skipping already secured self-hosted image digest ${digestRef} from ${imageRef}.\n`);
      continue;
    }

    const sbomPath = buildSelfHostedImageSbomPath(outputDirectory, digestRef);
    const provenancePath = buildSelfHostedImageProvenancePath(outputDirectory, digestRef);
    process.stdout.write(`Securing self-hosted image ${digestRef} from ${imageRef}.\n`);
    await writeSelfHostedImageSbom(input.repositoryRoot, digestRef, sbomPath);
    writeSelfHostedImageProvenance(digestRef, serviceName, provenancePath);
    signSelfHostedImage(input.repositoryRoot, digestRef);
    await verifySelfHostedImageSignature(input.repositoryRoot, digestRef);
    attestSelfHostedImageSbom(input.repositoryRoot, digestRef, sbomPath);
    attestSelfHostedImageProvenance(input.repositoryRoot, digestRef, provenancePath);
    securedDigestRefs.add(digestRef);
  }
}

export function scanSelfHostedImages(input) {
  const dockerScoutFailedImageRefs = [];
  const imageRefs =
    input.imageRefs?.length > 0 ? input.imageRefs : buildSelfHostedImageRefs(input.repositoryPrefix, input.tags);
  const scannedImageRefs = new Set();
  const trivyFailedImageRefs = [];

  for (const imageRef of imageRefs) {
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

  reportSelfHostedImageScanFailures({
    dockerScoutFailedImageRefs,
    trivyFailedImageRefs,
  });
}

export function readSecureSelfHostedImageOptions(args) {
  let dockerScout = false;
  const imageRefs = [];
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

    if (argument === '--image-ref') {
      imageRefs.push(readRequiredOptionValue(args, index + 1, '--image-ref'));
      index += 1;
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

  if (validateProvenanceAttestation && (tags.length !== 0 || imageRefs.length !== 0)) {
    throw new Error('Expected no image tags or refs with --validate-provenance-attestation.');
  }

  if (imageRefs.length !== 0 && tags.length !== 0) {
    throw new Error('Cannot combine image tags with --image-ref.');
  }

  if (!validateProvenanceAttestation && tags.length === 0 && imageRefs.length === 0) {
    throw new Error(
      'Expected at least one self-hosted image tag. Example: `node ./scripts/deploy/secure-self-hosted-images.mjs sha-<commit> main`.',
    );
  }

  return {
    dockerScout,
    imageRefs: [...new Set(imageRefs)],
    outputDirectory,
    repositoryPrefix,
    scanOnly,
    tags: [...new Set(tags)],
    validateProvenanceAttestation,
  };
}

function readScannedDigestResolutionInput(args) {
  if (args.length !== 4) {
    throw new Error(
      'Expected image name, scanned digest, Docker Hub digest, and GHCR digest after --resolve-scanned-digest.',
    );
  }

  return {
    dockerhubDigest: args[2],
    ghcrDigest: args[3],
    imageName: args[0],
    scannedDigest: args[1],
  };
}

function buildSelfHostedImageRefs(repositoryPrefix, tags) {
  return selfHostedRuntimeImageArtifacts.flatMap((serviceName) =>
    tags.map((tag) => buildSecureSelfHostedImageRef(repositoryPrefix, serviceName, tag)),
  );
}

function buildSecureSelfHostedImageTargets(input) {
  if (input.imageRefs?.length > 0) {
    return input.imageRefs.map((digestRef) => ({
      digestRef: validateSelfHostedImageDigestRef(digestRef),
      imageRef: digestRef,
      serviceName: readSelfHostedServiceNameFromDigestRef(digestRef),
    }));
  }

  return selfHostedRuntimeImageArtifacts.flatMap((serviceName) =>
    input.tags.map((tag) => {
      const imageRef = buildSecureSelfHostedImageRef(input.repositoryPrefix, serviceName, tag);
      return {
        digestRef: readSelfHostedImageDigestRef(input.repositoryRoot, imageRef),
        imageRef,
        serviceName,
      };
    }),
  );
}

function validateSelfHostedImageDigestRef(digestRef) {
  const digestSeparatorIndex = digestRef.lastIndexOf('@');
  if (digestSeparatorIndex === -1) {
    throw new Error(`Expected digest-pinned Docker image ref, received: ${digestRef}`);
  }

  assertImageDigest(digestRef.slice(digestSeparatorIndex + 1));
  return digestRef;
}

function readSelfHostedServiceNameFromDigestRef(digestRef) {
  const serviceName = selfHostedRuntimeImageArtifacts.find((candidate) =>
    digestRef.includes(`/compartment-${candidate}@`),
  );
  if (serviceName === undefined) {
    throw new Error(`Expected self-hosted runtime image digest ref, received: ${digestRef}`);
  }

  return serviceName;
}

function buildSecureSelfHostedImageRef(repositoryPrefix, serviceName, tag) {
  return buildSelfHostedImageRefForRepository(serviceName, tag, repositoryPrefix ?? defaultRepositoryPrefix);
}

export function buildDigestImageRef(imageRef, digest) {
  assertImageDigest(digest);

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
  // Docker Scout ignores local VEX statements in its --exit-code verdict, so we
  // gate deterministically ourselves: run Scout to a SARIF report (no
  // --exit-code) and fail only on fixable HIGH/CRITICAL findings that are not
  // covered by a suppression, using the same suppression source Trivy honors.
  const suppressedVulnerabilityIds = readScoutSuppressedVulnerabilityIds(repositoryRoot);
  const sarifDirectory = mkdtempSync(join(tmpdir(), 'compartment-scout-sarif-'));
  const sarifPath = join(sarifDirectory, 'scout.sarif.json');
  try {
    const scoutResult = captureCommandResult(
      'docker',
      [
        'scout',
        'cves',
        '--only-fixed',
        '--only-severity',
        'critical,high',
        '--format',
        'sarif',
        '--output',
        sarifPath,
        imageRef,
      ],
      repositoryRoot,
    );
    if (scoutResult.error !== undefined) {
      throw scoutResult.error;
    }
    if (scoutResult.stdout) {
      process.stdout.write(scoutResult.stdout);
    }
    if (scoutResult.stderr) {
      process.stderr.write(scoutResult.stderr);
    }
    // Without --exit-code, a non-zero exit (or a kill signal) can only mean an
    // operational scanner error, not a vulnerability verdict. Fail closed on it
    // so a scout auth/DB failure that still emits a valid-but-empty SARIF cannot
    // pass the gate.
    if (scoutResult.status !== 0 || scoutResult.signal !== null) {
      throw new Error(
        `Docker Scout scan errored for ${imageRef} (exit ${scoutResult.status}, signal ${scoutResult.signal}).`,
      );
    }
    const blockingVulnerabilityIds = readScoutBlockingVulnerabilityIds(sarifPath, suppressedVulnerabilityIds);
    if (blockingVulnerabilityIds.length > 0) {
      throw new Error(
        `Docker Scout found fixable HIGH/CRITICAL vulnerabilities without a suppression for ${imageRef}: ${blockingVulnerabilityIds.join(', ')}`,
      );
    }
  } finally {
    rmSync(sarifDirectory, { force: true, recursive: true });
  }
}

function readScoutSuppressedVulnerabilityIds(repositoryRoot) {
  const vexPath = resolve(repositoryRoot, dockerScoutVexFile);
  let raw;
  try {
    raw = readFileSync(vexPath, 'utf8');
  } catch {
    // No suppression file: suppress nothing (strict — every finding blocks).
    return new Set();
  }
  const vex = JSON.parse(raw);
  const suppressedVulnerabilityIds = new Set();
  for (const statement of vex.statements ?? []) {
    if (statement.status === 'not_affected' && typeof statement.vulnerability?.name === 'string') {
      suppressedVulnerabilityIds.add(statement.vulnerability.name);
    }
  }
  return suppressedVulnerabilityIds;
}

function readScoutBlockingVulnerabilityIds(sarifPath, suppressedVulnerabilityIds) {
  let raw;
  try {
    raw = readFileSync(sarifPath, 'utf8');
  } catch {
    // Fail closed: no report means we cannot prove the image is clean.
    throw new Error(`Docker Scout did not produce a SARIF report at ${sarifPath}.`);
  }
  const sarif = JSON.parse(raw);
  const blockingVulnerabilityIds = new Set();
  for (const run of sarif.runs ?? []) {
    for (const result of run.results ?? []) {
      const resultVulnerabilityIds = collectResultVulnerabilityIds(result);
      const isSuppressed = [...resultVulnerabilityIds].some((id) => suppressedVulnerabilityIds.has(id));
      if (!isSuppressed) {
        const [firstId] = resultVulnerabilityIds;
        blockingVulnerabilityIds.add(firstId ?? (typeof result.ruleId === 'string' ? result.ruleId : 'unknown'));
      }
    }
  }
  return [...blockingVulnerabilityIds];
}

// Exact CVE/GHSA identifiers, so a suppressed id cannot substring-collide with a
// wider real one (e.g. CVE-2024-3094 vs CVE-2024-30949).
const cveOrGhsaIdPattern = /CVE-\d{4}-\d{4,}|GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/gi;

function collectResultVulnerabilityIds(result) {
  const ids = new Set();
  if (typeof result?.ruleId === 'string') {
    ids.add(result.ruleId);
  }
  const messageText = result?.message?.text;
  if (typeof messageText === 'string') {
    for (const match of messageText.matchAll(cveOrGhsaIdPattern)) {
      ids.add(match[0]);
    }
  }
  return ids;
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
  return `${scannerName} failed the fixable HIGH/CRITICAL vulnerability gate for ${failedImageRefs.length} self-hosted image(s):\n${failureList}`;
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

${scannerName} failed the fixable HIGH/CRITICAL vulnerability gate for ${failedImageRefs.length} self-hosted image(s).

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

async function writeSelfHostedImageSbom(repositoryRoot, digestRef, sbomPath) {
  const args = ['image', '--no-progress', '--format', 'spdx-json', '--output', sbomPath, digestRef];
  for (const retryDelayMs of [...trivySbomRegistryReadRetryDelaysMs, undefined]) {
    const result = captureCommandResult('trivy', args, repositoryRoot);
    if (result.error !== undefined) {
      throw result.error;
    }
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    if (result.status === 0) {
      return;
    }

    const imageDigest = digestRef.slice(digestRef.lastIndexOf('@') + 1);
    const isTargetImageRegistryReadDenied = result.stderr.includes(
      `/manifests/${imageDigest}: ${trivyRegistryReadDeniedMessage}`,
    );
    if (!isTargetImageRegistryReadDenied || retryDelayMs === undefined) {
      throw new Error(`Command failed: ${['trivy', ...args].join(' ')}`);
    }

    await delay(retryDelayMs);
  }
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

runMain(import.meta.url, process.argv[1], main);
