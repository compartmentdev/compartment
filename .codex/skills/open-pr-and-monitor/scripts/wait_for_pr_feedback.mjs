#!/usr/bin/env node

import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

const FAILED_CHECK_CONCLUSIONS = new Set(['action_required', 'cancelled', 'failure', 'startup_failure', 'timed_out']);
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
              nodes {
                author { login }
                createdAt
                id
                url
              }
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
  const snapshot = await readSnapshot(repository, options.prNumber);

  writeResult(options, repository, snapshot);
}

function parseArgs(argv) {
  let headSha = null;
  let prNumber = null;
  let repo = null;

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

    if (value === '--repo') {
      repo = readRequiredValue(argv[index + 1], '--repo');
      index += 1;
      continue;
    }

    if (value === '--help' || value === '-h') {
      const helpText = `Usage: node .codex/skills/open-pr-and-monitor/scripts/wait_for_pr_feedback.mjs --pr <number> --head-sha <sha> [--repo <owner/repo>]

Reads the current PR checks, feedback, and merge state once, prints JSON, and exits.`;

      process.stdout.write(helpText);
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${value}`);
  }

  if (prNumber === null || headSha === null) {
    throw new Error('--pr and --head-sha are required');
  }

  return { headSha, prNumber, repo };
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
  const comments = normalizeIssueComments(pullRequestFeedback.comments);
  const reviews = normalizeReviews(pullRequestFeedback.reviews);

  return {
    checks: {
      items: checks,
      status: summarizeChecks(checks),
    },
    feedback: {
      comments,
      reviews,
      threads: reviewThreads,
      unresolvedThreadCount: reviewThreads.filter((thread) => thread.isResolved === false).length,
    },
    headSha: pullRequestState.headSha,
    lifecycle: {
      closedAt: pullRequestState.closedAt,
      mergedAt: pullRequestState.mergedAt,
      state: pullRequestState.state,
    },
    mergeStatus,
    terminalEvent: readPullRequestTerminalEvent(pullRequestState),
    url: pullRequestState.url,
  };
}

async function readChecks(repository, prNumber, headSha) {
  try {
    return await readVisibleChecks(repository, prNumber);
  } catch (error) {
    if (isNoChecksError(error)) {
      return [];
    }
    if (isStatusCheckRollupPermissionError(error)) {
      return await readVisibleChecksByHeadSha(repository, headSha);
    }

    throw error;
  }
}

async function readVisibleChecks(repository, prNumber) {
  const checks = await runGhJson(
    ['pr', 'checks', String(prNumber), '-R', repository.slug, '--json', 'name,bucket,state,workflow'],
    [1, 8],
  );

  if (!Array.isArray(checks)) {
    throw new Error('Expected visible checks JSON array.');
  }

  return checks
    .map((check) => ({
      kind: 'pull-request-check',
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
        comments: normalizeThreadComments(thread?.comments?.nodes),
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

function isNoChecksError(error) {
  if (!(error instanceof Error)) {
    return false;
  }

  const detail = readWrappedErrorDetail(error);
  return detail !== null && detail.includes('no checks reported');
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

async function runGhJson(args, acceptedExitCodes = []) {
  try {
    const result = await execFile('gh', args, { maxBuffer: GH_MAX_BUFFER_BYTES });
    return JSON.parse(result.stdout);
  } catch (error) {
    const stdout = typeof error.stdout === 'string' ? error.stdout.trim() : '';
    if (typeof error.code === 'number' && acceptedExitCodes.includes(error.code) && stdout !== '') {
      return JSON.parse(stdout);
    }

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

function normalizeIssueComments(comments) {
  if (!Array.isArray(comments)) {
    return [];
  }

  return comments
    .map((comment) => ({
      author: readOptionalString(comment?.author?.login),
      createdAt: readOptionalString(comment?.createdAt),
      id: readString(comment?.id, 'comments.id'),
      url: readOptionalString(comment?.url),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function normalizeReviews(reviews) {
  if (!Array.isArray(reviews)) {
    return [];
  }

  return reviews
    .map((review) => ({
      author: readOptionalString(review?.author?.login),
      commitSha: readOptionalString(review?.commit?.oid),
      id: readString(review?.id, 'reviews.id'),
      state: readString(review?.state, 'reviews.state'),
      submittedAt: readOptionalString(review?.submittedAt),
      url: readOptionalString(review?.url),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function normalizeThreadComments(comments) {
  if (!Array.isArray(comments)) {
    return [];
  }

  return comments
    .map((comment) => ({
      author: readOptionalString(comment?.author?.login),
      createdAt: readOptionalString(comment?.createdAt),
      id: readString(comment?.id, 'reviewThreads.comments.id'),
      url: readOptionalString(comment?.url),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function compareVisibleChecks(left, right) {
  return JSON.stringify(left).localeCompare(JSON.stringify(right));
}

function writeResult(options, repository, snapshot) {
  process.stdout.write(
    `${JSON.stringify(
      {
        checks: snapshot.checks,
        expectedHeadSha: options.headSha,
        feedback: snapshot.feedback,
        headChanged: snapshot.headSha !== options.headSha,
        headSha: snapshot.headSha,
        mergeStatus: snapshot.mergeStatus,
        pullRequest: {
          closedAt: snapshot.lifecycle.closedAt,
          mergedAt: snapshot.lifecycle.mergedAt,
          number: options.prNumber,
          repository: repository.slug,
          state: snapshot.lifecycle.state,
          url: snapshot.url,
        },
        terminalEvent: snapshot.terminalEvent,
      },
      null,
      2,
    )}\n`,
  );
}

function summarizeChecks(checks) {
  if (checks.length === 0) {
    return 'none';
  }

  let pending = false;
  for (const check of checks) {
    if (check.kind === 'pull-request-check') {
      const bucket = readOptionalString(check.bucket).toLowerCase();
      if (bucket === 'fail' || bucket === 'cancel') {
        return 'failed';
      }
      pending ||= bucket === 'pending';
      continue;
    }
    if (check.kind === 'workflow-run') {
      const conclusion = readOptionalString(check.conclusion).toLowerCase();
      if (FAILED_CHECK_CONCLUSIONS.has(conclusion)) {
        return 'failed';
      }
      pending ||= check.status !== 'completed';
      continue;
    }
    if (check.kind === 'commit-status') {
      const state = readOptionalString(check.state).toLowerCase();
      if (state === 'error' || state === 'failure') {
        return 'failed';
      }
      pending ||= state === 'pending';
      continue;
    }

    return 'unknown';
  }

  return pending ? 'pending' : 'passed';
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
