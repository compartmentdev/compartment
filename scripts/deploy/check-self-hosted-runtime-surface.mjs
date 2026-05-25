import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { listSelfHostedRuntimeImageSpecs } from './self-hosted-runtime-services.mjs';

const runtimeImages = listSelfHostedRuntimeImageSpecs();

const appRootViolationPredicate = [
  '\\(',
  '-path "/app/src" -o -path "/app/test" -o -path "/app/tests" -o -path "/app/__tests__"',
  '-o -name "*.map" -o -name "*.tsbuildinfo" -o -name "tsconfig*.json" -o -name "Dockerfile.self-hosted"',
  '-o \\( -name "*.ts" -a ! -name "*.d.ts" \\)',
  '-o \\( -name "*.tsx" -a ! -name "*.d.tsx" \\)',
  '-o -name "*.cts" -o -name "*.mts"',
  '\\)',
].join(' ');

const workspacePackageViolationPredicate = [
  '\\(',
  '-path "*/src" -o -path "*/test" -o -path "*/tests" -o -path "*/__tests__"',
  '-o -name "*.map" -o -name "*.tsbuildinfo" -o -name "tsconfig*.json" -o -name "Dockerfile.self-hosted"',
  '-o \\( -name "*.ts" -a ! -name "*.d.ts" \\)',
  '-o \\( -name "*.tsx" -a ! -name "*.d.tsx" \\)',
  '-o -name "*.cts" -o -name "*.mts"',
  '\\)',
].join(' ');

const runtimeSurfaceCheckCommand = `${[
  `if [ -d /app ]; then find /app -mindepth 1 -maxdepth 2 ${appRootViolationPredicate} -print; fi`,
  `if [ -d /app/node_modules/@compartment ]; then find /app/node_modules/@compartment ${workspacePackageViolationPredicate} -print; fi`,
].join('; ')}`;

await main();

async function main() {
  const envPath = resolve(readEnvPathArgument());
  const envText = await readFile(envPath, 'utf8');
  const violations = runtimeImages
    .map((runtimeImage) => inspectRuntimeImage(envText, runtimeImage))
    .filter((violation) => violation !== null);

  if (violations.length === 0) {
    return;
  }

  throw new Error(
    `Self-hosted runtime surface contains repo-owned source artifacts:\n\n${violations
      .map((violation) => `${violation.serviceName} (${violation.imageRef})\n${violation.matches}`)
      .join('\n\n')}`,
  );
}

function readEnvPathArgument() {
  const argument = process.argv.slice(2).find((value) => value !== '--');
  return argument ?? '.env.self-hosted.example';
}

function inspectRuntimeImage(envText, runtimeImage) {
  const imageRef = readRequiredEnvironmentValue(envText, runtimeImage.imageVariableName);
  const result = spawnSync(
    'docker',
    ['run', '--rm', '--entrypoint', 'sh', imageRef, '-lc', runtimeSurfaceCheckCommand],
    {
      encoding: 'utf8',
    },
  );

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() === '' ? `Failed to inspect ${imageRef}.` : result.stderr.trim());
  }

  const matches = result.stdout.trim();
  if (matches === '') {
    return null;
  }

  return {
    imageRef,
    matches,
    serviceName: runtimeImage.serviceName,
  };
}

function readRequiredEnvironmentValue(envText, variableName) {
  const envLine = envText.split('\n').find((line) => line.startsWith(`${variableName}=`));
  if (envLine !== undefined) {
    return envLine.slice(variableName.length + 1).trim();
  }

  throw new Error(`Expected ${variableName} in the self-hosted env file.`);
}
