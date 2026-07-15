import { execFile as execFileCallback } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { readRepositoryRoot } from '../lib/repository-root.mjs';
const defaultPath = process.env.PATH ?? '/usr/bin:/bin';
const distributionChannel = 'main';
const buildCommitSha = '1234567890abcdef1234567890abcdef12345678';
const defaultRegistryImageTag = 'sha-1234567890abcdef1234567890abcdef12345678';
const repositoryRoot = readRepositoryRoot(import.meta.url, 2);
const buildCliSeaScriptPath = resolve(repositoryRoot, 'scripts/release/build-cli-sea.mjs');
const temporaryDirectories = [];
const execFile = promisify(execFileCallback);
describe('build-cli-sea', () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.map(
        async (temporaryDirectory) => await rm(temporaryDirectory, { force: true, recursive: true }),
      ),
    );
    temporaryDirectories.length = 0;
  });
  it('embeds buildCommitSha into generated CLI build info when provided', async () => {
    const temporaryDirectory = await createTemporaryDirectory();
    const fixture = await createBuildCliSeaFixture(temporaryDirectory);
    await execFile(
      process.execPath,
      [
        buildCliSeaScriptPath,
        '--distribution-channel',
        distributionChannel,
        '--default-registry-image-tag',
        defaultRegistryImageTag,
        '--build-commit-sha',
        buildCommitSha,
        '--output-dir',
        fixture.outputDirectory,
      ],
      {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          CAPTURE_BUILD_INFO_PATH: fixture.captureBuildInfoPath,
          CAPTURE_BUILD_INFO_SCRIPT_PATH: fixture.captureBuildInfoScriptPath,
          CAPTURE_SEA_ASSETS_PATH: fixture.captureSeaAssetsPath,
          PATH: `${fixture.stubCommandDirectory}:${defaultPath}`,
          REAL_NODE_BINARY: process.execPath,
        },
      },
    );
    const capturedBuildInfo = await readCapturedBuildInfo(fixture.captureBuildInfoPath);
    const capturedSeaAssets = JSON.parse(await readFile(fixture.captureSeaAssetsPath, 'utf8'));
    expect(capturedBuildInfo.buildCommitSha).toBe(buildCommitSha);
    expect(capturedBuildInfo.defaultRegistryImageTag).toBe(defaultRegistryImageTag);
    expect(capturedBuildInfo.distributionChannel).toBe(distributionChannel);
    expect(capturedSeaAssets).toEqual({ 'cli-build-info.json': expect.any(String) });
  }, 20_000);
});
async function createTemporaryDirectory() {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'compartment-build-cli-sea-'));
  temporaryDirectories.push(temporaryDirectory);
  return temporaryDirectory;
}
async function createBuildCliSeaFixture(temporaryDirectory) {
  const stubCommandDirectory = join(temporaryDirectory, 'stub-bin');
  const outputDirectory = join(temporaryDirectory, 'out');
  const captureBuildInfoPath = join(temporaryDirectory, 'captured-build-info.json');
  const captureBuildInfoScriptPath = join(temporaryDirectory, 'capture-build-info.mjs');
  const captureSeaAssetsPath = join(temporaryDirectory, 'captured-sea-assets.json');
  await writeFile(captureBuildInfoScriptPath, buildCaptureBuildInfoScript(), 'utf8');
  await createStubCommands(stubCommandDirectory);
  return {
    captureBuildInfoPath,
    captureBuildInfoScriptPath,
    captureSeaAssetsPath,
    outputDirectory,
    stubCommandDirectory,
  };
}
async function createStubCommands(stubCommandDirectory) {
  await mkdir(stubCommandDirectory, { recursive: true });
  await writeExecutableScript(join(stubCommandDirectory, 'codesign'), buildCodesignStubScript());
  await writeExecutableScript(join(stubCommandDirectory, 'node'), buildNodeStubScript());
  await writeExecutableScript(join(stubCommandDirectory, 'pnpm'), buildPnpmStubScript());
}
async function readCapturedBuildInfo(captureBuildInfoPath) {
  const capturedBuildInfoText = await readFile(captureBuildInfoPath, 'utf8');
  return JSON.parse(capturedBuildInfoText);
}
function buildCaptureBuildInfoScript() {
  return `import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const [configPath, captureBuildInfoPath, captureSeaAssetsPath] = process.argv.slice(2);
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const buildInfoPath = config.assets['cli-build-info.json'];

mkdirSync(dirname(config.output), { recursive: true });
writeFileSync(config.output, 'blob');
copyFileSync(buildInfoPath, captureBuildInfoPath);
writeFileSync(captureSeaAssetsPath, JSON.stringify(config.assets, null, 2));
`;
}
function buildCodesignStubScript() {
  return createShellScript(`
exit 0
`);
}
function buildNodeStubScript() {
  return createShellScript(`
real_node_binary="\${REAL_NODE_BINARY:?}"
capture_build_info_path="\${CAPTURE_BUILD_INFO_PATH:?}"
capture_build_info_script_path="\${CAPTURE_BUILD_INFO_SCRIPT_PATH:?}"
capture_sea_assets_path="\${CAPTURE_SEA_ASSETS_PATH:?}"

if [ "$#" -eq 2 ] && [ "$1" = "--experimental-sea-config" ]; then
  config_path="$2"
  "$real_node_binary" "$capture_build_info_script_path" "$config_path" "$capture_build_info_path" "$capture_sea_assets_path"
  exit 0
fi

printf 'Unexpected node invocation: %s\\n' "$*" >&2
exit 1
`);
}
function buildPnpmStubScript() {
  return createShellScript(`
if [ "$#" -eq 2 ] && [ "$1" = "build" ] && [ "$2" = "--filter=@compartment/cli" ]; then
  exit 0
fi

if [ "$#" -ge 5 ] && [ "$1" = "exec" ] && [ "$2" = "ncc" ] && [ "$3" = "build" ]; then
  out_dir=""
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --out)
        out_dir="$2"
        shift 2
        ;;
      *)
        shift
        ;;
    esac
  done

  mkdir -p "$out_dir"
  printf 'console.log("stub bundle");\\n' > "$out_dir/index.js"
  exit 0
fi

if [ "$#" -ge 2 ] && [ "$1" = "exec" ] && [ "$2" = "postject" ]; then
  exit 0
fi

printf 'Unexpected pnpm invocation: %s\\n' "$*" >&2
exit 1
`);
}
function createShellScript(body) {
  return `#!/bin/sh
set -eu

${body.trim()}
`;
}
async function writeExecutableScript(path, contents) {
  await writeFile(path, contents, 'utf8');
  await chmod(path, 0o755);
}
