#!/usr/bin/env node

import { execFile as execFileCallback } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';

import { writePublicDocsWarning } from './public_docs_warning.mjs';

const execFile = promisify(execFileCallback);

const DEFAULT_INTERVAL_SECONDS = 300;
const DEFAULT_TIMEOUT_SECONDS = 1800;
const GH_MAX_BUFFER_BYTES = 16 * 1024 * 1024;
const REVIEW_THREADS_PAGE_SIZE = 100;

const READ_PULL_REQUEST_STATE_QUERY = `
  query WaitForPrState($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        closedAt
        headRefOid
        isInMergeQueue
        mergeStateStatus
        mergedAt
        mergeable
        potentialMergeCommit {
          oid
        }
        state
        url
      }
    }
  }
`;

const READ_PULL_REQUEST_STATE_QUERY_WITHOUT_MERGE_QUEUE = `
  query WaitForPrStateWithoutMergeQueue($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        closedAt
        headRefOid
        mergeStateStatus
        mergedAt
        mergeable
        potentialMergeCommit {
          oid
        }
        state
        url
      }
    }
  }
`;

const LIST_REVIEW_THREADS_QUERY = `
  query WaitForPrFeedback($owner: String!, $name: String!, $number: Int!, $cursor: String) {
    repository(owner: $owner, name: $name) {
      pullRequest(number: $number) {
        reviewThreads(first: ${REVIEW_THREADS_PAGE_SIZE}, after: $cursor) {
          nodes {
            id
            isOutdated
            isResolved
            comments(first: 100) {
              nodes { id }
            }
          }
          pageInfo { endCursor hasNextPage }
        }
      }
    }
  }
`;

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const repository = await resolveRepository(options.repo);
  let baseline = await readSnapshot(repository, options.prNumber);

  if (baseline.terminalEvent !== null) {
    writeResult(
      baseline.terminalEvent,
      options,
      repository,
      baseline,
      null,
      baseline.terminalEvent === 'merged' ? 'The PR is already merged.' : 'The PR is already closed.',
    );
    return;
  }

  if (baseline.headSha !== options.headSha) {
    writeResult(
      'head-changed',
      options,
      repository,
      baseline,
      null,
      'The PR head changed away from the pinned head SHA.',
    );
    return;
  }

  await writePublicDocsWarning({
    execFile,
    headSha: options.headSha,
    maxBufferBytes: GH_MAX_BUFFER_BYTES,
    stderr: process.stderr,
  });

  const startedAt = Date.now();
  const deadline = startedAt + options.timeoutSeconds * 1000;

  for (;;) {
    const remainingMilliseconds = deadline - Date.now();
    if (remainingMilliseconds <= 0) {
      writeResult(
        'timeout',
        options,
        repository,
        baseline,
        startedAt,
        'Timed out with no decision-ready PR changes on the pinned head (intermediate check churn may have been absorbed).',
      );
      return;
    }

    await sleep(Math.min(options.intervalSeconds * 1000, remainingMilliseconds));

    const current = await readSnapshot(repository, options.prNumber);

    if (current.terminalEvent !== null) {
      writeResult(
        current.terminalEvent,
        options,
        repository,
        current,
        startedAt,
        current.terminalEvent === 'merged'
          ? 'Detected that the PR was merged while monitoring the pinned head.'
          : 'Detected that the PR was closed while monitoring the pinned head.',
      );
      return;
    }

    if (current.headSha !== options.headSha) {
      writeResult(
        'head-changed',
        options,
        repository,
        current,
        startedAt,
        'The PR head changed away from the pinned head SHA.',
      );
      return;
    }

    if (current.hasConflicts === true && current.mergeKey !== baseline.mergeKey) {
      writeResult(
        'merge-conflict',
        options,
        repository,
        current,
        startedAt,
        'Detected PR merge conflicts or a dirty merge state on the pinned head.',
      );
      return;
    }

    if (current.feedbackKey !== baseline.feedbackKey) {
      writeResult(
        'feedback-changed',
        options,
        repository,
        current,
        startedAt,
        'Detected new PR feedback on the pinned head.',
      );
      return;
    }

    // Checks and merge-state churn constantly while CI runs (every check flips
    // pending -> in_progress -> success, and mergeStateStatus follows). Waking
    // the monitoring agent on every transition burns a full inspection pass per
    // flip. Only return once the picture is decision-ready: a failure appeared
    // or every check completed. Intermediate churn is absorbed into the
    // baseline so it never re-triggers.
    const checksMoved = current.checksKey !== baseline.checksKey;
    const mergeMoved = current.mergeKey !== baseline.mergeKey;
    if (checksMoved || mergeMoved) {
      const progress = readChecksProgress(current.checksKey);
      if (progress.failed || progress.settled) {
        writeResult(
          checksMoved ? 'checks-changed' : 'merge-state-changed',
          options,
          repository,
          current,
          startedAt,
          checksMoved
            ? 'Detected settled or failing required-check changes on the pinned head.'
            : 'Detected PR merge-state changes on the pinned head.',
        );
        return;
      }
      baseline = current;
    }
  }
}

const FAILED_CHECK_CONCLUSIONS = new Set(['action_required', 'cancelled', 'failure', 'startup_failure', 'timed_out']);

function readChecksProgress(checksKey) {
  const checks = JSON.parse(checksKey);
  if (!Array.isArray(checks) || checks.length === 0) {
    return { failed: false, settled: false };
  }
  let running = false;
  let failed = false;
  for (const check of checks) {
    if (check.kind === 'required-check') {
      // Entries from `gh pr checks --required` carry bucket/state, not
      // status/conclusion. Buckets: pass, fail, pending, skipping, cancel.
      const bucket = typeof check.bucket === 'string' ? check.bucket.toLowerCase() : '';
      if (bucket === 'pending') {
        running = true;
      }
      if (bucket === 'fail' || bucket === 'cancel') {
        failed = true;
      }
      continue;
    }
    if (check.kind === 'commit-status') {
      if (check.state === 'PENDING' || check.state === 'pending') {
        running = true;
      }
      if (['ERROR', 'FAILURE', 'error', 'failure'].includes(check.state)) {
        failed = true;
      }
      continue;
    }
    if (check.kind === 'workflow-run') {
      if (check.status !== 'completed') {
        running = true;
      }
      if (typeof check.conclusion === 'string' && FAILED_CHECK_CONCLUSIONS.has(check.conclusion)) {
        failed = true;
      }
      continue;
    }
    // Unknown snapshot shape: stay conservative — keep waiting; the timeout
    // heartbeat still bounds the wait.
    running = true;
  }
  return { failed, settled: !running };
}

function parseArgs(argv) {
  let headSha = null;
  let intervalSeconds = DEFAULT_INTERVAL_SECONDS;
  let prNumber = null;
  let repo = null;
  let timeoutSeconds = DEFAULT_TIMEOUT_SECONDS;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === '--pr') {
      prNumber = readPositiveInteger(argv[index + 1], '--pr');
      index += 1;
      continue;
    }

    if (value === '--head-sha') {
      headSha = readRequiredValue(argv[index + 1], '--head-sha');
      index += 1;
      continue;
    }

    if (value === '--interval-seconds') {
      intervalSeconds = readPositiveInteger(argv[index + 1], '--interval-seconds');
      index += 1;
      continue;
    }

    if (value === '--timeout-seconds') {
      timeoutSeconds = readPositiveInteger(argv[index + 1], '--timeout-seconds');
      index += 1;
      continue;
    }

    if (value === '--repo') {
      repo = readRequiredValue(argv[index + 1], '--repo');
      index += 1;
      continue;
    }

    if (value === '--help' || value === '-h') {
      const helpText = `Usage: node .codex/skills/open-pr-and-monitor/scripts/wait_for_pr_feedback.mjs --pr <number> --head-sha <sha> [--repo <owner/repo>] [--interval-seconds <n>] [--timeout-seconds <n>]

Returns one of: merged, closed, head-changed, merge-conflict, merge-state-changed, feedback-changed, checks-changed, timeout.`;

      process.stdout.write(helpText);
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${value}`);
  }

  if (prNumber === null || headSha === null) {
    throw new Error('--pr and --head-sha are required');
  }

  return { headSha, intervalSeconds, prNumber, repo, timeoutSeconds };
}

async function resolveRepository(repo) {
  if (repo !== null) {
    return parseRepositorySlug(repo);
  }

  const response = await runGhJson(['repo', 'view', '--json', 'nameWithOwner,url']);
  const slug = readString(response.nameWithOwner, 'nameWithOwner');
  const url = new URL(readString(response.url, 'url'));
  return parseRepositorySlug(url.hostname === 'github.com' ? slug : `${url.hostname}/${slug}`);
}

async function readSnapshot(repository, prNumber) {
  const pullRequestFeedbackPromise = runGhJson([
    'pr',
    'view',
    String(prNumber),
    '-R',
    repository.slug,
    '--json',
    'comments,reviews',
  ]);
  const pullRequestStatePromise = readPullRequestState(repository, prNumber);
  const reviewThreadsPromise = listReviewThreads(repository, prNumber);
  const checksPromise = pullRequestStatePromise.then((pullRequestState) => {
    return readChecks(repository, prNumber, pullRequestState.headSha);
  });
  const [pullRequestFeedback, pullRequestState, reviewThreads, checks] = await Promise.all([
    pullRequestFeedbackPromise,
    pullRequestStatePromise,
    reviewThreadsPromise,
    checksPromise,
  ]);

  const mergeStatus = {
    hasConflicts: hasMergeConflicts(pullRequestState),
    isInMergeQueue: pullRequestState.isInMergeQueue,
    mergeStateStatus: pullRequestState.mergeStateStatus,
    mergeable: pullRequestState.mergeable,
    potentialMergeCommitOid: pullRequestState.potentialMergeCommitOid,
  };

  return {
    checksKey: JSON.stringify(checks),
    feedbackKey: JSON.stringify({
      comments: normalizeIssueCommentIds(pullRequestFeedback.comments),
      reviews: normalizeReviewIds(pullRequestFeedback.reviews),
      threads: reviewThreads,
    }),
    hasConflicts: mergeStatus.hasConflicts,
    headSha: pullRequestState.headSha,
    lifecycle: {
      closedAt: pullRequestState.closedAt,
      mergedAt: pullRequestState.mergedAt,
      state: pullRequestState.state,
    },
    mergeKey: JSON.stringify({
      hasConflicts: mergeStatus.hasConflicts,
      isInMergeQueue: mergeStatus.isInMergeQueue,
      mergeStateStatus: mergeStatus.mergeStateStatus,
      mergeable: mergeStatus.mergeable,
    }),
    mergeStatus,
    terminalEvent: readPullRequestTerminalEvent(pullRequestState),
    url: pullRequestState.url,
  };
}

async function readChecks(repository, prNumber, headSha) {
  try {
    return await readRequiredChecks(repository, prNumber);
  } catch (error) {
    if (isCheckFallbackError(error) === false) {
      throw error;
    }

    return await readVisibleChecksByHeadSha(repository, headSha);
  }
}

async function readRequiredChecks(repository, prNumber) {
  const checks = await runGhJson([
    'pr',
    'checks',
    String(prNumber),
    '-R',
    repository.slug,
    '--required',
    '--json',
    'name,bucket,state,workflow',
  ]);

  if (!Array.isArray(checks)) {
    throw new Error('Expected required checks JSON array.');
  }

  return checks
    .map((check) => ({
      kind: 'required-check',
      bucket: readString(check.bucket, 'checks.bucket'),
      name: readString(check.name, 'checks.name'),
      state: readString(check.state, 'checks.state'),
      workflow: typeof check.workflow === 'string' ? check.workflow : '',
    }))
    .sort((left, right) => `${left.workflow}/${left.name}`.localeCompare(`${right.workflow}/${right.name}`));
}

async function readVisibleChecksByHeadSha(repository, headSha) {
  const [workflowRuns, commitStatus] = await Promise.all([
    runGhJson([
      'run',
      'list',
      '-R',
      repository.slug,
      '--commit',
      headSha,
      '--limit',
      '100',
      '--json',
      'databaseId,workflowName,name,status,conclusion,event',
    ]),
    runGhJson([
      'api',
      '--hostname',
      repository.hostname,
      `repos/${repository.owner}/${repository.name}/commits/${headSha}/status`,
    ]),
  ]);

  if (!Array.isArray(workflowRuns)) {
    throw new Error('Expected workflow runs JSON array.');
  }

  const statuses = Array.isArray(commitStatus?.statuses) ? commitStatus.statuses : [];

  return [
    ...workflowRuns.map((workflowRun) => ({
      kind: 'workflow-run',
      conclusion: readOptionalString(workflowRun?.conclusion),
      event: readOptionalString(workflowRun?.event),
      id: readIdString(workflowRun?.databaseId, 'workflowRuns.databaseId'),
      name: readString(workflowRun?.name, 'workflowRuns.name'),
      status: readString(workflowRun?.status, 'workflowRuns.status'),
      workflow: readOptionalString(workflowRun?.workflowName),
    })),
    ...statuses.map((status) => ({
      kind: 'commit-status',
      context: readString(status?.context, 'commitStatuses.context'),
      description: readOptionalString(status?.description),
      state: readString(status?.state, 'commitStatuses.state'),
      targetUrl: readOptionalString(status?.target_url),
    })),
  ].sort(compareVisibleChecks);
}

async function listReviewThreads(repository, prNumber) {
  const threads = [];
  let cursor = null;

  for (;;) {
    const response = await runGhJson([
      'api',
      'graphql',
      '--hostname',
      repository.hostname,
      '-f',
      `query=${LIST_REVIEW_THREADS_QUERY}`,
      '-F',
      `owner=${repository.owner}`,
      '-F',
      `name=${repository.name}`,
      '-F',
      `number=${prNumber}`,
      ...(cursor === null ? [] : ['-F', `cursor=${cursor}`]),
    ]);
    const connection = response.data?.repository?.pullRequest?.reviewThreads;
    const nodes = Array.isArray(connection?.nodes) ? connection.nodes : [];

    threads.push(
      ...nodes.map((thread) => ({
        comments: normalizeThreadCommentIds(thread?.comments?.nodes),
        id: readString(thread?.id, 'reviewThreads.id'),
        isOutdated: Boolean(thread?.isOutdated),
        isResolved: Boolean(thread?.isResolved),
      })),
    );

    if (connection?.pageInfo?.hasNextPage !== true || typeof connection.pageInfo.endCursor !== 'string') {
      return threads.sort((left, right) => left.id.localeCompare(right.id));
    }

    cursor = connection.pageInfo.endCursor;
  }
}

async function readPullRequestState(repository, prNumber) {
  const response = await runPrStateGraphqlQuery(repository, prNumber);
  const pullRequest = response.data?.repository?.pullRequest;
  const supportsMergeQueue = hasMergeQueueField(pullRequest);

  return {
    closedAt: readOptionalString(pullRequest?.closedAt),
    headSha: readString(pullRequest?.headRefOid, 'pullRequest.headRefOid'),
    isInMergeQueue: supportsMergeQueue ? readBoolean(pullRequest?.isInMergeQueue, 'pullRequest.isInMergeQueue') : false,
    mergeStateStatus: readString(pullRequest?.mergeStateStatus, 'pullRequest.mergeStateStatus'),
    mergedAt: readOptionalString(pullRequest?.mergedAt),
    mergeable: readString(pullRequest?.mergeable, 'pullRequest.mergeable'),
    potentialMergeCommitOid: readOptionalString(pullRequest?.potentialMergeCommit?.oid),
    state: readString(pullRequest?.state, 'pullRequest.state'),
    url: readString(pullRequest?.url, 'pullRequest.url'),
  };
}

async function runPrStateGraphqlQuery(repository, prNumber) {
  try {
    return await runGhJson(buildPrStateGraphqlArgs(repository, prNumber, READ_PULL_REQUEST_STATE_QUERY));
  } catch (error) {
    if (isMissingIsInMergeQueueError(error) === false) {
      throw error;
    }

    return await runGhJson(
      buildPrStateGraphqlArgs(repository, prNumber, READ_PULL_REQUEST_STATE_QUERY_WITHOUT_MERGE_QUEUE),
    );
  }
}

function buildPrStateGraphqlArgs(repository, prNumber, query) {
  return [
    'api',
    'graphql',
    '--hostname',
    repository.hostname,
    '-f',
    `query=${query}`,
    '-F',
    `owner=${repository.owner}`,
    '-F',
    `name=${repository.name}`,
    '-F',
    `number=${prNumber}`,
  ];
}

function hasMergeConflicts(pullRequestState) {
  return pullRequestState.mergeable === 'CONFLICTING' || pullRequestState.mergeStateStatus === 'DIRTY';
}

function hasMergeQueueField(pullRequest) {
  return pullRequest !== null && typeof pullRequest === 'object' && 'isInMergeQueue' in pullRequest;
}

function readPullRequestTerminalEvent(pullRequestState) {
  if (pullRequestState.state === 'MERGED') {
    return 'merged';
  }

  if (pullRequestState.state === 'CLOSED') {
    return 'closed';
  }

  return null;
}

function isStatusCheckRollupPermissionError(error) {
  if (!(error instanceof Error)) {
    return false;
  }

  const detail = readWrappedErrorDetail(error);
  if (detail === null) {
    return false;
  }

  return (
    detail.includes('statusCheckRollup') &&
    (detail.includes('Resource not accessible by personal access token') ||
      detail.includes('Resource not accessible by integration'))
  );
}

function isCheckFallbackError(error) {
  return isStatusCheckRollupPermissionError(error) || isNoRequiredChecksError(error);
}

function isNoRequiredChecksError(error) {
  if (!(error instanceof Error)) {
    return false;
  }

  const detail = readWrappedErrorDetail(error);
  return detail !== null && detail.includes('no required checks reported');
}

function isMissingIsInMergeQueueError(error) {
  if (!(error instanceof Error)) {
    return false;
  }

  const stderr = readWrappedErrorStderr(error);
  if (stderr === null) {
    return false;
  }

  return (
    stderr.includes('isInMergeQueue') &&
    (stderr.includes("doesn't exist") || stderr.includes('Field') || stderr.includes('undefinedField'))
  );
}

function parseRepositorySlug(repo) {
  const parts = repo.split('/');
  if (parts.length < 2) {
    throw new Error(`Invalid --repo value: ${repo}`);
  }

  const name = parts.at(-1);
  const owner = parts.at(-2);
  const hostnameParts = parts.slice(0, -2);
  const hostname = hostnameParts.length === 0 ? 'github.com' : hostnameParts.join('/');

  if (!owner || !name || hostname.length === 0) {
    throw new Error(`Invalid --repo value: ${repo}`);
  }

  return {
    hostname,
    name,
    owner,
    slug: hostname === 'github.com' ? `${owner}/${name}` : `${hostname}/${owner}/${name}`,
  };
}

async function runGhJson(args) {
  try {
    const result = await execFile('gh', args, { maxBuffer: GH_MAX_BUFFER_BYTES });
    return JSON.parse(result.stdout);
  } catch (error) {
    const detail =
      typeof error.stderr === 'string' && error.stderr.trim().length > 0 ? error.stderr.trim() : error.message;
    const wrappedError = new Error(`gh ${args.join(' ')} failed: ${detail}`);
    wrappedError.stderr = typeof error.stderr === 'string' ? error.stderr : '';
    throw wrappedError;
  }
}

function readWrappedErrorStderr(error) {
  if ('stderr' in error && typeof error.stderr === 'string' && error.stderr.length > 0) {
    return error.stderr;
  }

  return null;
}

function readWrappedErrorDetail(error) {
  const stderr = readWrappedErrorStderr(error);
  if (stderr !== null) {
    return stderr;
  }

  return error.message.length > 0 ? error.message : null;
}

function normalizeIssueCommentIds(comments) {
  if (!Array.isArray(comments)) {
    return [];
  }

  return comments.map((comment) => readString(comment?.id, 'comments.id')).sort();
}

function normalizeReviewIds(reviews) {
  if (!Array.isArray(reviews)) {
    return [];
  }

  return reviews
    .map((review) => {
      const commitOid = typeof review?.commit?.oid === 'string' ? review.commit.oid : '';
      return `${readString(review?.id, 'reviews.id')}:${commitOid}`;
    })
    .sort();
}

function normalizeThreadCommentIds(comments) {
  if (!Array.isArray(comments)) {
    return [];
  }

  return comments.map((comment) => readString(comment?.id, 'reviewThreads.comments.id')).sort();
}

function compareVisibleChecks(left, right) {
  return JSON.stringify(left).localeCompare(JSON.stringify(right));
}

function writeResult(event, options, repository, snapshot, startedAt, summary) {
  const elapsedSeconds = startedAt === null ? 0 : Math.max(0, Math.round((Date.now() - startedAt) / 1000));

  process.stdout.write(
    `${JSON.stringify(
      {
        currentHeadSha: snapshot.headSha,
        elapsedSeconds,
        event,
        expectedHeadSha: options.headSha,
        mergeStatus: snapshot.mergeStatus,
        pullRequest: {
          closedAt: snapshot.lifecycle.closedAt,
          mergedAt: snapshot.lifecycle.mergedAt,
          number: options.prNumber,
          repository: repository.slug,
          state: snapshot.lifecycle.state,
          url: snapshot.url,
        },
        summary,
      },
      null,
      2,
    )}\n`,
  );
}

function readPositiveInteger(value, flagName) {
  const parsed = Number.parseInt(readRequiredValue(value, flagName), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flagName} must be a positive integer`);
  }

  return parsed;
}

function readRequiredValue(value, flagName) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${flagName} requires a value`);
  }

  return value;
}

function readString(value, fieldName) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Expected ${fieldName} to be a non-empty string.`);
  }

  return value;
}

function readOptionalString(value) {
  return typeof value === 'string' ? value : '';
}

function readIdString(value, fieldName) {
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new Error(`Expected ${fieldName} to be a number or string.`);
  }

  return String(value);
}

function readBoolean(value, fieldName) {
  if (typeof value !== 'boolean') {
    throw new Error(`Expected ${fieldName} to be a boolean.`);
  }

  return value;
}
