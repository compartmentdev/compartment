import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { publicDocsAreas } from '../../../../scripts/docs/public-docs/public-docs-areas.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '../../../..');
export async function writePublicDocsWarning({ execFile, headSha, maxBufferBytes, stderr }) {
  try {
    const warning = await buildPublicDocsWarning({ execFile, headSha, maxBufferBytes });
    if (warning !== null) {
      stderr.write(`${warning}\n`);
    }
  } catch {
    // Advisory only. Ignore lookup failures so monitor startup stays non-blocking.
  }
}

async function buildPublicDocsWarning({ execFile, headSha, maxBufferBytes }) {
  const changedEntries = await readPublicDocsChangedEntries({ execFile, headSha, maxBufferBytes });
  if (changedEntries.length === 0) {
    return null;
  }

  const changedPaths = collectChangedPaths(changedEntries);
  const missingAreas = findImpactedPublicDocsGuideAreas(changedPaths).filter((area) => {
    return hasGuideChange(area, changedEntries) === false;
  });

  if (missingAreas.length === 0) {
    return null;
  }

  const relevantEntries = changedEntries.filter((entry) => {
    return matchesAnyPath(readChangedEntryPaths(entry), flattenGuidePatterns(missingAreas));
  });
  const lines = [
    'Notice: this diff touches files mapped to public-docs guide areas.',
    'Update public docs only if users must change behavior, understand a public contract, or make an operator decision.',
    '',
    'Changed files:',
    ...relevantEntries.map(formatChangedEntry),
    '',
    'Potential public-doc follow-up:',
  ];

  for (const area of missingAreas) {
    lines.push(`- ${area.label}`);
    lines.push('  - Review only if docs are truly required:');
    lines.push(...area.guides.map((guide) => `    - ${guide.path}`));
  }

  lines.push('');
  lines.push('Generated reference freshness is still validated separately by `pnpm docs:check`.');
  return lines.join('\n');
}

async function readPublicDocsChangedEntries({ execFile, headSha, maxBufferBytes }) {
  const mergeBase = await readMergeBase({ baseSha: 'origin/main', execFile, headSha, maxBufferBytes });
  return await readGitDiffEntries({
    args: ['diff', '--name-status', '-z', '--diff-filter=ACDMRTUXB', mergeBase, headSha],
    execFile,
    maxBufferBytes,
  });
}

async function readMergeBase({ baseSha, execFile, headSha, maxBufferBytes }) {
  const result = await execFile('git', ['merge-base', baseSha, headSha], {
    cwd: repositoryRoot,
    maxBuffer: maxBufferBytes,
  });
  return result.stdout.trim();
}

async function readGitDiffEntries({ args, execFile, maxBufferBytes }) {
  const result = await execFile('git', args, { cwd: repositoryRoot, maxBuffer: maxBufferBytes });
  if (result.stdout === '') {
    return [];
  }

  const tokens = result.stdout.split('\0').filter((value) => value !== '');
  const entries = [];
  let index = 0;

  while (index < tokens.length) {
    const statusToken = tokens[index++];
    if (statusToken === undefined) {
      break;
    }

    const status = statusToken.slice(0, 1);
    if (status === 'R' || status === 'C') {
      const previousPath = tokens[index++];
      const path = tokens[index++];
      if (previousPath !== undefined && path !== undefined) {
        entries.push({ path, previousPath, status });
      }
      continue;
    }

    const path = tokens[index++];
    if (path !== undefined) {
      entries.push({ path, previousPath: null, status });
    }
  }

  return entries;
}

function collectChangedPaths(entries) {
  const paths = new Set();

  for (const entry of entries) {
    for (const path of readChangedEntryPaths(entry)) {
      paths.add(path);
    }
  }

  return [...paths].sort((left, right) => left.localeCompare(right));
}

function findImpactedPublicDocsGuideAreas(paths) {
  return publicDocsAreas.filter((area) => matchesAnyPath(paths, area.guideSourcePatterns));
}

function hasGuideChange(area, changedEntries) {
  return changedEntries.some((entry) => {
    return entry.status !== 'D' && area.guides.some((guide) => readChangedEntryPaths(entry).includes(guide.path));
  });
}

function flattenGuidePatterns(areas) {
  return areas.flatMap((area) => area.guideSourcePatterns);
}

function matchesAnyPath(paths, patterns) {
  return paths.some((path) => patterns.some((pattern) => pattern.test(path)));
}

function readChangedEntryPaths(entry) {
  return entry.previousPath === null ? [entry.path] : [entry.previousPath, entry.path];
}

function formatChangedEntry(entry) {
  return entry.previousPath === null
    ? `- [${entry.status}] ${entry.path}`
    : `- [${entry.status}] ${entry.previousPath} -> ${entry.path}`;
}
