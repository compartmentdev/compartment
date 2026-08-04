import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const expectedArtifactName: string = 'compartment-linux-x64.tar.gz';
export const expectedInstalledVersion: string = '0.1.0-main+1234567';
const expectedMainCommitSha: string = '1234567890abcdef1234567890abcdef12345678';
export const expectedMainReleaseTag: string = `sha-${expectedMainCommitSha}`;
export const expectedKubernetesCommitSha: string = 'abcdef1234567890abcdef1234567890abcdef12';
export const expectedKubernetesReleaseTag: string = `sha-${expectedKubernetesCommitSha}`;
const expectedCliManifestDigest: string = `sha256:${'c'.repeat(64)}`;
export const expectedCliDigestRef: string = `ghcr.io/compartmentdev/compartment-cli@${expectedCliManifestDigest}`;
export const expectedPublishedKubernetesCommitSha: string = '9876543210abcdef9876543210abcdef98765432';
export const expectedPublishedKubernetesReleaseTag: string = `sha-${expectedPublishedKubernetesCommitSha}`;
const expectedPublishedCliManifestDigest: string = `sha256:${'d'.repeat(64)}`;
export const expectedPublishedCliDigestRef: string = `ghcr.io/compartmentdev/compartment-cli@${expectedPublishedCliManifestDigest}`;

interface StubCommandOptions {
  archName?: string | undefined;
  osName?: string | undefined;
}

export function readExpectedArtifactName(osName?: string, archName?: string): string {
  const installerArch: string = isArm64InstallerArch(archName) ? 'arm64' : 'x64';
  return `compartment-${normalizeInstallerOsName(osName)}-${installerArch}.tar.gz`;
}

export function readExpectedOrasPlatform(osName?: string, archName?: string): string {
  const orasArch: string = isArm64InstallerArch(archName) ? 'arm64' : 'amd64';
  return `${normalizeInstallerOsName(osName)}/${orasArch}`;
}

export async function createStubCommands(stubCommandDirectory: string, options: StubCommandOptions): Promise<void> {
  await mkdir(stubCommandDirectory, { recursive: true });
  await writeExecutableScript(join(stubCommandDirectory, 'cosign'), buildStubCosignScript());
  await writeExecutableScript(join(stubCommandDirectory, 'curl'), buildStubCurlScript());
  await writeExecutableScript(join(stubCommandDirectory, 'oras'), buildStubOrasScript());
  await writeExecutableScript(
    join(stubCommandDirectory, 'uname'),
    buildStubUnameScript(options.osName, options.archName),
  );
  await writeExecutableScript(join(stubCommandDirectory, 'sudo'), buildStubSudoScript());
}

export function buildInstalledCompartmentScript(): string {
  return createShellScript(`
state_dir="\${COMPARTMENT_TEST_STATE_DIR:?}"
mkdir -p "$state_dir"
printf '%s\\n' "$*" >> "\${state_dir}/compartment.log"

case "\${1:-}" in
  --version)
    printf '${expectedInstalledVersion}\\n'
    ;;
  install)
    printf 'Installed Compartment.\\n'
    ;;
  login)
    api_url=""
    email=""
    organization=""
    onboarding_session=""
    shift
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --api-url)
          api_url="$2"
          shift 2
          ;;
        --email)
          email="$2"
          shift 2
          ;;
        --organization)
          organization="$2"
          shift 2
          ;;
        --onboarding-session)
          onboarding_session="$2"
          shift 2
          ;;
        *)
          printf 'Unexpected login arg: %s\\n' "$1" >&2
          exit 1
          ;;
      esac
    done
    printf 'Logged in to %s as %s.\\n' "$api_url" "$email"
    ;;
  system)
    if [ "\${2:-}" != "update" ]; then
      printf 'Unexpected system command: %s\\n' "$*" >&2
      exit 1
    fi
    printf 'Updated Compartment platform.\\n'
    ;;
  *)
    printf 'Unexpected installed compartment args: %s\\n' "$*" >&2
    exit 1
    ;;
esac
`);
}

export async function writeExecutableScript(path: string, contents: string): Promise<void> {
  await writeFile(path, contents, 'utf8');
  await chmod(path, 0o755);
}

function normalizeInstallerOsName(osName?: string): string {
  return (osName ?? 'Linux').trim().toLowerCase();
}

function normalizeInstallerArchName(archName?: string): string {
  return (archName ?? 'x86_64').trim().toLowerCase();
}

function isArm64InstallerArch(archName?: string): boolean {
  const normalizedArchName: string = normalizeInstallerArchName(archName);
  return normalizedArchName === 'arm64' || normalizedArchName === 'aarch64';
}

function buildStubCurlScript(): string {
  return createShellScript(`
artifact_path="\${COMPARTMENT_TEST_ARTIFACT_PATH:?}"
checksums_path="\${COMPARTMENT_TEST_CHECKSUMS_PATH:?}"
published_fallback_outcome="\${COMPARTMENT_TEST_PUBLISHED_FALLBACK_OUTCOME:?}"
state_dir="\${COMPARTMENT_TEST_STATE_DIR:?}"

mkdir -p "$state_dir"
output_path=""
url=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    -o)
      output_path="$2"
      shift 2
      ;;
    -*)
      shift
      ;;
    *)
      url="$1"
      shift
      ;;
  esac
done

printf '%s\\n' "$url" >> "\${state_dir}/urls.log"

case "$url" in
  https://api.github.com/repos/example/compartment/git/ref/heads/main)
    printf '{"object":{"sha":"${expectedMainCommitSha}"}}\\n'
    ;;
  https://api.github.com/repos/example/compartment/git/ref/heads/kubernetes)
    printf '{"object":{"sha":"${expectedKubernetesCommitSha}"}}\\n'
    ;;
  "https://api.github.com/repos/example/compartment/actions/workflows/publish-self-hosted-kubernetes.yml/runs?branch=kubernetes&status=success&per_page=1")
    if [ "$published_fallback_outcome" = "lookup-missing" ]; then
      printf '{"workflow_runs":[]}\\n'
    else
      printf '{"workflow_runs":[{"head_sha":"${expectedPublishedKubernetesCommitSha}"}]}\\n'
    fi
    ;;
  https://github.com/sigstore/cosign/releases/download/v2.6.1/cosign-*)
    printf 'invalid downloaded cosign fixture\\n' > "$output_path"
    ;;
  https://github.com/example/compartment/releases/download/sha-*/checksums.txt)
    cp "$checksums_path" "$output_path"
    ;;
  https://github.com/example/compartment/releases/download/sha-*/compartment-*.tar.gz)
    cp "$artifact_path" "$output_path"
    ;;
  https://github.com/example/compartment/releases/download/v*/checksums.txt)
    cp "$checksums_path" "$output_path"
    ;;
  https://github.com/example/compartment/releases/download/v*/compartment-*.tar.gz)
    cp "$artifact_path" "$output_path"
    ;;
  https://github.com/example/compartment/releases/latest/download/checksums.txt)
    cp "$checksums_path" "$output_path"
    ;;
  https://github.com/example/compartment/releases/latest/download/compartment-*.tar.gz)
    cp "$artifact_path" "$output_path"
    ;;
  *)
    printf 'Unexpected curl URL: %s\\n' "$url" >&2
    exit 1
    ;;
esac
`);
}

function buildStubCosignScript(): string {
  return createShellScript(`
state_dir="\${COMPARTMENT_TEST_STATE_DIR:?}"
signature_outcome="\${COMPARTMENT_TEST_SIGNATURE_OUTCOME:?}"
published_fallback_outcome="\${COMPARTMENT_TEST_PUBLISHED_FALLBACK_OUTCOME:?}"
tool_version_mode="\${COMPARTMENT_TEST_TOOL_VERSION_MODE:?}"

if [ "$*" = "version" ]; then
  if [ "$tool_version_mode" = "compatible" ]; then
    printf '  GitVersion: v2.6.1\\n'
  else
    printf '  GitVersion: v1.13.1\\n'
  fi
  exit 0
fi

mkdir -p "$state_dir"
printf '%s\\n' "$*" >> "\${state_dir}/cosign.log"

expected_tip_args="verify --new-bundle-format --certificate-identity https://github.com/compartmentdev/compartment/.github/workflows/publish-self-hosted-kubernetes.yml@refs/heads/kubernetes --certificate-oidc-issuer https://token.actions.githubusercontent.com --certificate-github-workflow-sha ${expectedKubernetesCommitSha} ${expectedCliDigestRef}"
expected_published_args="verify --new-bundle-format --certificate-identity https://github.com/compartmentdev/compartment/.github/workflows/publish-self-hosted-kubernetes.yml@refs/heads/kubernetes --certificate-oidc-issuer https://token.actions.githubusercontent.com --certificate-github-workflow-sha ${expectedPublishedKubernetesCommitSha} ${expectedPublishedCliDigestRef}"
if [ "$*" != "$expected_tip_args" ] && [ "$*" != "$expected_published_args" ]; then
  printf 'Unexpected cosign args: %s\\n' "$*" >&2
  exit 1
fi
if [ "$*" = "$expected_published_args" ] && [ "$published_fallback_outcome" = "signature-invalid" ]; then
  printf 'fallback signature mismatch\\n' >&2
  exit 1
fi

case "$signature_outcome" in
  valid)
    printf 'cosign verification internals\n'
    : > "\${state_dir}/cosign-verified"
    ;;
  unsigned)
    printf 'no signatures found\\n' >&2
    exit 1
    ;;
  foreign-identity)
    printf 'certificate identity mismatch\\n' >&2
    exit 1
    ;;
  wrong-workflow-sha)
    printf 'workflow SHA mismatch\\n' >&2
    exit 1
    ;;
esac
`);
}

function buildStubOrasScript(): string {
  return createShellScript(`
artifact_path="\${COMPARTMENT_TEST_ARTIFACT_PATH:?}"
checksums_path="\${COMPARTMENT_TEST_CHECKSUMS_PATH:?}"
expected_artifact_name="\${COMPARTMENT_TEST_EXPECTED_ARTIFACT_NAME:?}"
expected_platform="\${COMPARTMENT_TEST_EXPECTED_ORAS_PLATFORM:?}"
state_dir="\${COMPARTMENT_TEST_STATE_DIR:?}"
tool_version_mode="\${COMPARTMENT_TEST_TOOL_VERSION_MODE:?}"
oras_resolve_outcome="\${COMPARTMENT_TEST_ORAS_RESOLVE_OUTCOME:?}"
oras_pull_outcome="\${COMPARTMENT_TEST_ORAS_PULL_OUTCOME:?}"
published_fallback_outcome="\${COMPARTMENT_TEST_PUBLISHED_FALLBACK_OUTCOME:?}"

if [ "$*" = "version" ]; then
  if [ "$tool_version_mode" = "compatible" ]; then
    printf 'Version: 1.3.3\\n'
  else
    printf 'Version: 0.16.0\\n'
  fi
  exit 0
fi

mkdir -p "$state_dir"
printf '%s\\n' "$*" >> "\${state_dir}/oras.log"

case "\${1:-}" in
  resolve)
    case "$*" in
      "resolve ghcr.io/compartmentdev/compartment-cli:${expectedKubernetesReleaseTag}")
        if [ "$oras_resolve_outcome" = "missing" ]; then
          printf 'Error response from registry: failed to resolve digest: not found\\n' >&2
          exit 1
        fi
        if [ "$oras_resolve_outcome" = "unavailable" ]; then
          printf 'registry unavailable\\n' >&2
          exit 1
        fi
        printf '${expectedCliManifestDigest}\\n'
        ;;
      "resolve ghcr.io/compartmentdev/compartment-cli:${expectedPublishedKubernetesReleaseTag}")
        if [ "$published_fallback_outcome" = "resolve-missing" ]; then
          printf 'Error response from registry: failed to resolve digest: not found\\n' >&2
          exit 1
        fi
        printf '${expectedPublishedCliManifestDigest}\\n'
        ;;
      *)
        printf 'Unexpected oras resolve args: %s\\n' "$*" >&2
        exit 1
        ;;
    esac
    ;;
  pull)
    if [ "$oras_pull_outcome" = "failure" ]; then
      printf 'registry download interrupted after 42 MB\n' >&2
      exit 1
    fi
    if [ ! -f "\${state_dir}/cosign-verified" ]; then
      printf 'Refusing CLI payload pull before cosign verification.\\n' >&2
      exit 1
    fi
    output_path=""
    shift
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --platform)
          if [ "$2" != "$expected_platform" ]; then
            printf 'Unexpected oras pull platform: %s\\n' "$2" >&2
            exit 1
          fi
          shift 2
          ;;
        --output)
          output_path="$2"
          shift 2
          ;;
        ${expectedCliDigestRef})
          shift
          ;;
        *)
          printf 'Unexpected oras pull arg: %s\\n' "$1" >&2
          exit 1
          ;;
      esac
    done
    cp "$artifact_path" "$output_path/$expected_artifact_name"
    cp "$checksums_path" "$output_path/checksums.txt"
    printf 'Skipped pulling layers without selected files\n'
    ;;
  *)
    printf 'Unexpected oras command: %s\\n' "$*" >&2
    exit 1
    ;;
esac
`);
}

function buildStubUnameScript(osName: string = 'Linux', archName: string = 'x86_64'): string {
  return createShellScript(`
case "\${1:-}" in
  -s)
    printf '${osName}\\n'
    ;;
  -m)
    printf '${archName}\\n'
    ;;
  *)
    printf 'Unexpected uname args: %s\\n' "$*" >&2
    exit 1
    ;;
esac
`);
}

function buildStubSudoScript(): string {
  return createShellScript(`
state_dir="\${COMPARTMENT_TEST_STATE_DIR:?}"
mkdir -p "$state_dir"
printf '%s\\n' "$*" >> "\${state_dir}/sudo.log"
exec "$@"
`);
}

function createShellScript(body: string): string {
  return `#!/bin/sh
set -eu

${body.trim()}
`;
}
