import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { readRequiredOptionValue } from '../lib/options.mjs';
import {
  buildSelfHostedImageRef,
  buildSelfHostedRuntimeImageVariableName,
  selfHostedRuntimeImageArtifacts,
} from './self-hosted-runtime-services.mjs';

const defaultTemplatePath = '.env.self-hosted.example';

export function renderSelfHostedEnv({ primaryTag, templateText }) {
  const overrides = buildSelfHostedEnvOverrides(primaryTag);

  return templateText
    .split('\n')
    .map((line) => {
      const separatorIndex = line.indexOf('=');
      if (separatorIndex <= 0) {
        return line;
      }

      const variableName = line.slice(0, separatorIndex);
      const overrideValue = overrides[variableName];
      return overrideValue === undefined ? line : `${variableName}=${overrideValue}`;
    })
    .join('\n');
}

export async function writeRenderedSelfHostedEnv({ outputPath, primaryTag, templatePath = defaultTemplatePath }) {
  const resolvedOutputPath = resolve(outputPath);
  const templateText = await readFile(resolve(templatePath), 'utf8');
  await mkdir(dirname(resolvedOutputPath), { recursive: true });
  await writeFile(resolvedOutputPath, renderSelfHostedEnv({ primaryTag, templateText }));
}

function buildSelfHostedEnvOverrides(primaryTag) {
  const overrides = {
    COMPARTMENT_NODE_VERSION: primaryTag,
  };

  for (const serviceName of selfHostedRuntimeImageArtifacts) {
    overrides[buildSelfHostedRuntimeImageVariableName(serviceName)] = buildSelfHostedImageRef(serviceName, primaryTag);
  }

  return overrides;
}

function readRenderSelfHostedEnvOptions(args) {
  const options = {
    outputPath: undefined,
    primaryTag: undefined,
    templatePath: defaultTemplatePath,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--output') {
      options.outputPath = readRequiredOptionValue(args, ++index, '--output');
      continue;
    }
    if (argument === '--primary-tag') {
      options.primaryTag = readRequiredOptionValue(args, ++index, '--primary-tag');
      continue;
    }
    if (argument === '--template') {
      options.templatePath = readRequiredOptionValue(args, ++index, '--template');
      continue;
    }

    throw new Error(`Unknown render self-hosted env argument: ${argument}`);
  }

  if (options.outputPath === undefined) {
    throw new Error('Expected --output.');
  }
  if (options.primaryTag === undefined) {
    throw new Error('Expected --primary-tag.');
  }

  return {
    outputPath: options.outputPath,
    primaryTag: options.primaryTag,
    templatePath: options.templatePath,
  };
}

async function main() {
  await writeRenderedSelfHostedEnv(readRenderSelfHostedEnvOptions(process.argv.slice(2)));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
