import { renderFrontmatter, renderGuideLinks, renderMarkdown } from './markdown-output.mjs';
import { writeTextIfChanged } from './public-docs-files.mjs';
import { findPublicDocsAreaByCliRoot } from './public-docs-map.mjs';
import { readRepositoryTypescriptExport } from './repository-typescript-module.mjs';

const GENERATED_CLI_DIRECTORY = 'public-docs/src/content/docs/reference/generated/cli';

export async function generateCliReferencePages() {
  const rootNode = await readCliHelpTree();

  for (const subcommand of rootNode.subcommands) {
    await generateCliReferenceSubtree(subcommand);
  }
}

async function generateCliReferenceSubtree(node) {
  await writeTextIfChanged(buildCommandPagePath(node.pathSegments), renderCommandPage(node));

  for (const subcommand of node.subcommands) {
    await generateCliReferenceSubtree(subcommand);
  }
}

async function readCliHelpTree() {
  return readRepositoryTypescriptExport(
    new URL('../../../packages/cli/src/help-tree.ts', import.meta.url),
    'createCliHelpTree',
  );
}

function buildCommandPagePath(pathSegments) {
  return `${GENERATED_CLI_DIRECTORY}/${pathSegments.join('/')}.md`;
}

function renderCommandPage(node) {
  const commandName = buildRenderedCommandName(node.pathSegments);
  const area = findPublicDocsAreaByCliRoot(node.pathSegments[0] ?? '');

  return renderMarkdown([
    renderFrontmatter(commandName, `Generated help output for ${commandName}.`),
    'This page is generated from the current shipped `compartment` help output.',
    '',
    ...renderGuideLinks(area),
    '## Help Output',
    '',
    '```text',
    node.helpText,
    '```',
    '',
    ...renderRelatedCommands(node),
  ]);
}

function buildRenderedCommandName(pathSegments) {
  return ['compartment', ...pathSegments].join(' ');
}

function renderRelatedCommands(node) {
  if (node.subcommands.length === 0) {
    return [];
  }

  return [
    '## Related Commands',
    '',
    ...node.subcommands.map((subcommand) => {
      const childSegments = subcommand.pathSegments;
      return `- [compartment ${childSegments.join(' ')}](/reference/generated/cli/${childSegments.join('/')}/)`;
    }),
  ];
}
