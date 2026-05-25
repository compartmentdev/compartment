import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const START_MARKER = '<!-- devin-review-link:start -->';
const END_MARKER = '<!-- devin-review-link:end -->';
const GITHUB_API_VERSION = '2026-03-10';

async function main() {
  const eventPath = readRequiredEnv('GITHUB_EVENT_PATH');
  const token = readRequiredEnv('GITHUB_TOKEN');
  const event = await readPullRequestEvent(eventPath);
  const result = renderUpdatedPullRequestBody(event.pull_request.html_url, event.pull_request.body);

  if (!result.changed) {
    process.stdout.write(`Devin Review link already present for PR #${event.pull_request.number}.\n`);
    return;
  }

  await updatePullRequestBody(event.pull_request.url, result.body, token);
  process.stdout.write(`Updated PR #${event.pull_request.number} with a Devin Review link.\n`);
}

async function readPullRequestEvent(eventPath) {
  const payload = JSON.parse(await readFile(eventPath, 'utf8'));

  if (!isPullRequestEvent(payload)) {
    throw new Error(`Expected ${eventPath} to contain a pull_request event payload.`);
  }

  return payload;
}

function renderUpdatedPullRequestBody(pullRequestUrl, currentBody) {
  const nextBody = upsertDevinReviewSection(currentBody, buildDevinReviewSection(pullRequestUrl));

  return {
    body: nextBody,
    changed: nextBody !== normalizeBody(currentBody),
  };
}

function buildDevinReviewSection(pullRequestUrl) {
  const directReviewUrl = buildDirectDevinReviewUrl(pullRequestUrl);

  if (directReviewUrl !== null) {
    return renderMarkdownBlock([
      START_MARKER,
      '## Devin Review',
      `[Start Devin Review](${directReviewUrl})`,
      'Run this only when the PR is ready for manual Devin Review.',
      END_MARKER,
    ]);
  }

  return renderMarkdownBlock([
    START_MARKER,
    '## Devin Review',
    '[Open Devin Review](https://app.devin.ai/review)',
    `Paste this PR URL into Devin Review: \`${pullRequestUrl}\``,
    END_MARKER,
  ]);
}

function buildDirectDevinReviewUrl(pullRequestUrl) {
  const githubPrefix = 'https://github.com/';
  if (!pullRequestUrl.startsWith(githubPrefix)) {
    return null;
  }

  return `https://devinreview.com/${pullRequestUrl.slice(githubPrefix.length)}`;
}

function upsertDevinReviewSection(currentBody, section) {
  const normalizedBody = normalizeBody(currentBody);
  const sectionStartIndex = normalizedBody.indexOf(START_MARKER);
  const sectionEndIndex =
    sectionStartIndex >= 0 ? normalizedBody.indexOf(END_MARKER, sectionStartIndex + START_MARKER.length) : -1;

  if (sectionStartIndex >= 0 && sectionEndIndex > sectionStartIndex) {
    return replaceMarkedSection(normalizedBody, section, sectionStartIndex, sectionEndIndex + END_MARKER.length);
  }

  if (normalizedBody === '') {
    return section;
  }

  return `${normalizedBody}\n\n${section}`;
}

function replaceMarkedSection(currentBody, section, sectionStartIndex, sectionEndIndex) {
  const beforeSection = currentBody.slice(0, sectionStartIndex).trimEnd();
  const afterSection = currentBody.slice(sectionEndIndex).trimStart();

  if (beforeSection !== '' && afterSection !== '') {
    return `${beforeSection}\n\n${section}\n\n${afterSection}`;
  }

  if (beforeSection !== '') {
    return `${beforeSection}\n\n${section}`;
  }

  if (afterSection !== '') {
    return `${section}\n\n${afterSection}`;
  }

  return section;
}

function normalizeBody(body) {
  if (typeof body !== 'string') {
    return '';
  }

  return body.trim();
}

function renderMarkdownBlock(lines) {
  return lines.join('\n');
}

async function updatePullRequestBody(pullRequestApiUrl, body, token) {
  const response = await fetch(pullRequestApiUrl, {
    method: 'PATCH',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
    },
    body: JSON.stringify({ body }),
  });

  if (response.ok) {
    return;
  }

  const errorBody = await response.text();
  throw new Error(`GitHub API request failed with ${response.status}: ${errorBody}`);
}

function isPullRequestEvent(value) {
  if (!isRecord(value)) {
    return false;
  }

  if (!isRecord(value.pull_request)) {
    return false;
  }

  return (
    typeof value.pull_request.url === 'string' &&
    typeof value.pull_request.html_url === 'string' &&
    typeof value.pull_request.number === 'number' &&
    (typeof value.pull_request.body === 'string' || value.pull_request.body === null)
  );
}

function isRecord(value) {
  return typeof value === 'object' && value !== null;
}

function readRequiredEnv(name) {
  const value = process.env[name];
  if (typeof value === 'string' && value !== '') {
    return value;
  }

  throw new Error(`${name} must be set.`);
}

if (typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
