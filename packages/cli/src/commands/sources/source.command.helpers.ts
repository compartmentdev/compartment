import type {
  GitSourceExclusionMutationResponse,
  GitSourceBindingSummary,
  GitSourceDetails,
  GitSourceLatestSync,
  GitSourceLatestSyncCandidate,
  GitSourceListResponse,
  GitSourceResponse,
  GitSourceSettings,
  GitSourceSettingsResponse,
  GitSourceSummary,
} from '@compartment/contracts';
import type { CliIo } from '../../app.types';
import { readPromptLine } from '../../prompts/prompt-reader';

const sourceCommandPollIntervalMs: number = 2_000;
const sourceCommandPollTimeoutMs: number = 5 * 60_000;

interface SourceCommandPollOptions<TValue> {
  isTerminal: (value: TValue) => boolean;
  readValue: () => Promise<TValue>;
  timeoutMessage: string;
}

export function createGitSourceListMessage(response: GitSourceListResponse): string {
  if (response.sources.length === 0) {
    return 'No Git sources connected.';
  }

  return response.sources
    .map(
      (source: GitSourceSummary): string =>
        `${source.id}\t${source.displayName}\t${source.defaultBranchName}\t${source.status}`,
    )
    .join('\n');
}

export function createGitSourceDisconnectMessage(sourceId: string): string {
  return `Disconnected source ${sourceId}.`;
}

export function createGitSourceConnectMessage(response: GitSourceResponse): string {
  const branchName: string = response.source.latestSync?.requestedBranchName ?? response.source.defaultBranchName;
  return renderLines([
    `Connected source ${response.source.id}.`,
    createGitSourceShowMessage(response),
    `Bootstrap discovery, auto-adopt, and initial deploy started on branch ${branchName}.`,
  ]);
}

export function createGitSourceShowMessage(response: GitSourceResponse): string {
  return createGitSourceDetailsMessage(response.source);
}

function createGitSourceDetailsMessage(source: GitSourceDetails): string {
  const header: string[] = [
    `Source ${source.id}`,
    `Repo: ${source.displayName}`,
    `Default branch: ${source.defaultBranchName}`,
    `Auto-adopt new apps: ${source.autoAdoptNewApps ? 'enabled' : 'disabled'}`,
    `Default environment: ${source.defaultEnvironmentName}`,
    `Default deploy mode: ${source.defaultAutoDeployEnabled ? 'auto' : 'manual'}`,
    `Status: ${source.status}`,
  ];
  const bindings: string[] = source.bindings.map((binding: GitSourceBindingSummary): string => formatBinding(binding));

  return renderLines([
    renderLines(header),
    'Bindings:',
    bindings.length > 0 ? renderLines(bindings) : '- none',
    ...createExclusionLines(source.exclusions),
    ...createLatestSyncLines(source.latestSync),
  ]);
}

function formatBinding(binding: GitSourceBindingSummary): string {
  return [
    `- ${binding.id}`,
    binding.projectName,
    binding.descriptorPath,
    `${binding.branchName} -> ${binding.environmentName}`,
    binding.autoDeployEnabled ? 'auto' : 'manual',
  ].join('\t');
}

function createLatestSyncLines(latestSync: GitSourceLatestSync | null): string[] {
  if (latestSync === null) {
    return ['Latest sync: none'];
  }

  const acceptedCount: number = latestSync.candidates.filter(
    (candidate: GitSourceLatestSyncCandidate): boolean => candidate.status === 'accepted',
  ).length;
  const blockedCandidates: GitSourceLatestSyncCandidate[] = latestSync.candidates.filter(
    (candidate: GitSourceLatestSyncCandidate): boolean => candidate.status === 'blocked',
  );
  const lines: string[] = [
    `Latest sync: ${latestSync.id}\t${latestSync.status}\t${latestSync.requestedBranchName}\t${latestSync.resolvedCommitSha ?? 'unknown'}`,
    `Latest sync candidates: accepted=${acceptedCount}, blocked=${blockedCandidates.length}`,
  ];

  if (blockedCandidates.length > 0) {
    lines.push('Blocked sync candidates:');
    lines.push(...blockedCandidates.map(formatBlockedCandidate));
  }

  if (latestSync.failureReason !== null) {
    lines.push(`Latest sync failure: ${latestSync.failureReason}`);
  }

  return lines;
}

export function createGitSourceSettingsMessage(sourceId: string, response: GitSourceSettingsResponse): string {
  return createGitSourceSettingsDetailsMessage(sourceId, response.settings);
}

export function createGitSourceExcludeMessage(response: GitSourceExclusionMutationResponse): string {
  return `Excluded ${response.descriptorPath} from source ${response.sourceId}.`;
}

function formatBlockedCandidate(candidate: GitSourceLatestSyncCandidate): string {
  return `- ${candidate.descriptorPath}\t${candidate.projectName ?? 'unknown project'}\t${candidate.blockedReason ?? 'Blocked.'}`;
}

function createGitSourceSettingsDetailsMessage(sourceId: string, settings: GitSourceSettings): string {
  return renderLines([
    `Source settings ${sourceId}`,
    `Auto-adopt new apps: ${settings.autoAdoptNewApps ? 'enabled' : 'disabled'}`,
    ...createExclusionLines(settings.exclusions),
  ]);
}

function createExclusionLines(exclusions: readonly { descriptorPath: string }[]): string[] {
  if (exclusions.length === 0) {
    return ['Excluded apps: none'];
  }

  return [
    'Excluded apps:',
    ...exclusions.map((exclusion: { descriptorPath: string }): string => `- ${exclusion.descriptorPath}`),
  ];
}

function renderLines(lines: readonly string[]): string {
  return lines.join('\n');
}

export function parseEnabledDisabledState(value: string, label: string): boolean {
  if (value === 'enabled') {
    return true;
  }
  if (value === 'disabled') {
    return false;
  }

  throw new Error(`${label} must be enabled or disabled.`);
}

export async function promptYesNoChoice(io: CliIo, prompt: string): Promise<boolean> {
  const answer: string = (await readPromptLine(io, prompt)).trim().toLowerCase();
  return answer === '' || answer === 'y' || answer === 'yes';
}

export async function pollSourceCommandValue<TValue>(options: SourceCommandPollOptions<TValue>): Promise<TValue> {
  const deadline: number = Date.now() + sourceCommandPollTimeoutMs;
  while (Date.now() < deadline) {
    await waitForSourceCommandPollInterval();
    const value: TValue = await options.readValue();
    if (options.isTerminal(value)) {
      return value;
    }
  }

  throw new Error(options.timeoutMessage);
}

async function waitForSourceCommandPollInterval(): Promise<void> {
  const { setTimeout: delay } = await import('node:timers/promises');
  await delay(sourceCommandPollIntervalMs);
}
