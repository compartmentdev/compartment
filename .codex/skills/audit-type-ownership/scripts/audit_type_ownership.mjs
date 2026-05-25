#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const PACKAGE_ORDER = [
  'api',
  'contracts',
  'sdk',
  'source-archive',
  'cli',
  'node',
  'edge',
  'worker',
  'docker',
  'utils',
  'test-support',
];
const PACKAGE_LOCAL_DUPLICATE_NAME_PATTERN = /(Input|Context|Plan|Result|Options|State|Config|App)$/;
const CONTRACT_OWNER_MATRIX = [
  { owner: 'contracts', rule: 'Serialized DTOs, public *Request/*Response/*Summary, shared status/value aliases' },
  { owner: 'query layer', rule: '*Row, *Selection, *Transaction, *Executor, persistence mutation inputs' },
  { owner: 'service layer', rule: '*Input, *Context, *Plan, *Result' },
  { owner: 'app/adapter layer', rule: '*Options, *State, *Config, *App' },
];
const ENFORCED_BY = ['scripts/eslint-rules/package-file-placement-convention.mjs', 'git commit (pre-commit hook)'];

main();

function main() {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = findRepoRoot(process.cwd());
  const packageContexts = readPackageContexts(repoRoot);
  const scan = scanPackages(repoRoot, packageContexts);
  const report = buildReport(repoRoot, packageContexts, scan, options.packageName);

  if (options.format === 'json') {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  process.stdout.write(renderMarkdown(report));
}

function parseArgs(argv) {
  let format = 'markdown';
  let packageName = null;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--format') {
      const next = argv[index + 1];
      if (next !== 'markdown' && next !== 'json') {
        fail(`Unsupported format: ${next ?? '(missing)'}`);
      }
      format = next;
      index += 1;
      continue;
    }

    if (value === '--package') {
      const next = argv[index + 1];
      if (next === undefined || !PACKAGE_ORDER.includes(next)) {
        fail(`Unsupported package: ${next ?? '(missing)'}`);
      }
      packageName = next;
      index += 1;
      continue;
    }

    if (value === '--help' || value === '-h') {
      const helpText = `Usage: node .codex/skills/audit-type-ownership/scripts/audit_type_ownership.mjs [--package <name>] [--format markdown|json]

Packages: ${PACKAGE_ORDER.join(', ')}`;

      process.stdout.write(helpText);
      process.exit(0);
    }

    fail(`Unknown argument: ${value}`);
  }

  return { format, packageName };
}

function findRepoRoot(startDir) {
  let currentDir = resolve(startDir);

  while (true) {
    if (existsSync(join(currentDir, 'AGENTS.md')) && existsSync(join(currentDir, 'packages'))) {
      return currentDir;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error('Could not find the compartment repo root from the current working directory.');
    }

    currentDir = parentDir;
  }
}

function readPackageContexts(repoRoot) {
  return PACKAGE_ORDER.flatMap((packageName) => {
    const packageJsonPath = join(repoRoot, 'packages', packageName, 'package.json');
    if (!existsSync(packageJsonPath)) {
      return [];
    }

    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    const dependencies = packageJson.dependencies ?? {};
    const devDependencies = packageJson.devDependencies ?? {};

    return [
      {
        packageName,
        packageJsonPath,
        internalDependencies: readWorkspaceDependencies(dependencies),
        internalDevDependencies: readWorkspaceDependencies(devDependencies),
        externalDependencyCount: countExternalDependencies(dependencies),
        externalDevDependencyCount: countExternalDependencies(devDependencies),
      },
    ];
  });
}

function scanPackages(repoRoot, packageContexts) {
  const typeDeclarations = [];
  const platformImports = [];
  const serviceContractReturns = [];
  const rootExportRisks = [];
  const placementConventionRisks = [];
  const serviceOwnedQueryTypes = [];

  for (const packageContext of packageContexts) {
    const packageRoot = join(repoRoot, 'packages', packageContext.packageName);
    const sourceRoot = join(packageRoot, 'src');
    const sourceFiles = existsSync(sourceRoot) ? collectTypeScriptFiles(sourceRoot) : [];

    for (const filePath of sourceFiles) {
      const sourceText = readFileSync(filePath, 'utf8');
      typeDeclarations.push(...parseTypeDeclarations(repoRoot, packageContext.packageName, filePath, sourceText));
      platformImports.push(...parseCompartmentImports(repoRoot, packageContext.packageName, filePath, sourceText));

      if (isServiceImplementationFile(filePath)) {
        serviceContractReturns.push(
          ...parseServiceContractReturns(repoRoot, packageContext.packageName, filePath, sourceText),
        );
      }

      if (isRootIndexFile(filePath)) {
        rootExportRisks.push(...parseRootExportRisks(repoRoot, packageContext.packageName, filePath, sourceText));
      }

      placementConventionRisks.push(...parsePlacementConventionRisks(repoRoot, packageContext.packageName, filePath));
    }

    serviceOwnedQueryTypes.push(
      ...typeDeclarations.filter(
        (declaration) =>
          declaration.packageName === packageContext.packageName &&
          declaration.relativePath.includes('/services/') &&
          /(Row|Selection|Transaction|Executor)$/.test(declaration.name),
      ),
    );
  }

  return {
    typeDeclarations,
    platformImports,
    serviceContractReturns,
    rootExportRisks,
    placementConventionRisks,
    serviceOwnedQueryTypes,
  };
}

function collectTypeScriptFiles(directoryPath) {
  const entries = readdirSync(directoryPath).sort();
  const files = [];

  for (const entry of entries) {
    const absolutePath = join(directoryPath, entry);
    const entryStat = statSync(absolutePath);

    if (entryStat.isDirectory()) {
      if (['coverage', 'dist', 'node_modules', 'test', '__tests__'].includes(entry)) {
        continue;
      }

      files.push(...collectTypeScriptFiles(absolutePath));
      continue;
    }

    if (!absolutePath.endsWith('.ts')) {
      continue;
    }

    if (absolutePath.endsWith('.test.ts') || absolutePath.endsWith('.spec.ts')) {
      continue;
    }

    files.push(absolutePath);
  }

  return files;
}

function parseTypeDeclarations(repoRoot, packageName, filePath, sourceText) {
  const declarations = [];
  const lines = sourceText.split('\n');
  let insideImportOrExportBlock = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmedLine = line.trim();

    if (startsImportOrExportBlock(trimmedLine)) {
      insideImportOrExportBlock = !endsImportOrExportBlock(trimmedLine);
      continue;
    }

    if (insideImportOrExportBlock) {
      if (endsImportOrExportBlock(trimmedLine)) {
        insideImportOrExportBlock = false;
      }
      continue;
    }

    const match = line.match(/^\s*(export\s+)?(interface|type)\s+([A-Z][A-Za-z0-9_]*)\b/);
    if (match === null) {
      continue;
    }

    declarations.push({
      exported: match[1] !== undefined,
      kind: match[2],
      line: index + 1,
      name: match[3],
      packageName,
      relativePath: toRepoPath(repoRoot, filePath),
    });
  }

  return declarations;
}

function parseCompartmentImports(repoRoot, packageName, filePath, sourceText) {
  const imports = [];
  const importRegex = /import[\s\S]*?from\s+['"]([^'"]+)['"];?/g;

  for (const match of sourceText.matchAll(importRegex)) {
    const moduleId = match[1];
    const statement = normalizeWhitespace(match[0]);
    const line = readLineNumber(sourceText, match.index ?? 0);

    imports.push({
      importedNames: parseNamedImports(match[0]),
      line,
      moduleId,
      packageName,
      relativePath: toRepoPath(repoRoot, filePath),
      statement,
      targetPackage: moduleId.startsWith('@compartment/') ? moduleId.slice('@compartment/'.length) : null,
    });
  }

  return imports;
}

function parseServiceContractReturns(repoRoot, packageName, filePath, sourceText) {
  const contractReturnTypes = readImportedContractReturnTypes(sourceText);
  if (contractReturnTypes.length === 0) {
    return [];
  }

  const findings = [];
  const functionRegex = /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\([\s\S]*?\)\s*:\s*([^{]+?)\s*\{/g;

  for (const match of sourceText.matchAll(functionRegex)) {
    const functionName = match[1];
    const returnType = normalizeWhitespace(match[2]);
    const matchedContractType = contractReturnTypes.find((name) => new RegExp(`\\b${name}\\b`).test(returnType));
    if (matchedContractType === undefined) {
      continue;
    }

    findings.push({
      contractType: matchedContractType,
      functionName,
      line: readLineNumber(sourceText, match.index ?? 0),
      packageName,
      relativePath: toRepoPath(repoRoot, filePath),
      returnType,
    });
  }

  return findings;
}

function parseRootExportRisks(repoRoot, packageName, filePath, sourceText) {
  const risks = [];
  const exportRegex = /export\s+(?:\*|{[\s\S]*?})\s+from\s+['"]([^'"]+)['"];?/g;

  for (const match of sourceText.matchAll(exportRegex)) {
    const statement = normalizeWhitespace(match[0]);
    const target = match[1];
    const reasons = [];

    if (statement.startsWith('export *')) {
      reasons.push('broad star re-export');
    }
    if (target.includes('.types')) {
      reasons.push('re-exports a type-only module from the package root');
    }
    if (packageName === 'api' && (target.includes('/db/client') || target.includes('/db/schema'))) {
      reasons.push('re-exports persistence surface from the package root');
    }
    if (packageName !== 'contracts' && target.includes('/services/')) {
      reasons.push('re-exports service internals from the package root');
    }

    if (reasons.length === 0) {
      continue;
    }

    risks.push({
      line: readLineNumber(sourceText, match.index ?? 0),
      packageName,
      reasons,
      relativePath: toRepoPath(repoRoot, filePath),
      statement,
      target,
    });
  }

  return risks;
}

function buildReport(repoRoot, packageContexts, scan, packageName) {
  const scannedPackages = packageName === null ? PACKAGE_ORDER : [packageName];
  const filteredDeclarations = filterByPackage(scan.typeDeclarations, packageName, (entry) => entry.packageName);
  const filteredImports = filterByPackage(
    scan.platformImports,
    packageName,
    (entry) => entry.packageName,
    (entry) => entry.targetPackage,
  );
  const filteredContractReturns = filterByPackage(
    scan.serviceContractReturns,
    packageName,
    (entry) => entry.packageName,
  ).filter((entry) => entry.packageName === 'api');
  const filteredRootExportRisks = filterByPackage(scan.rootExportRisks, packageName, (entry) => entry.packageName);
  const filteredPlacementConventionRisks = filterByPackage(
    scan.placementConventionRisks,
    packageName,
    (entry) => entry.packageName,
  );
  const filteredServiceOwnedQueryTypes = filterByPackage(
    scan.serviceOwnedQueryTypes,
    packageName,
    (entry) => entry.packageName,
  );
  const duplicates = buildDuplicateTypeNames(scan.typeDeclarations, packageName);
  const apiQueryServiceTypeImports = buildApiQueryServiceTypeImports(scan.platformImports, packageName);
  const packageSummaries = buildPackageSummaries(packageContexts, filteredDeclarations, filteredImports, packageName);
  const crossPackageSummary = buildCrossPackageSummary(filteredImports, packageContexts);
  const nonContractCrossImports = filteredImports.filter(
    (entry) => entry.targetPackage !== null && entry.targetPackage !== 'contracts',
  );
  const moveList = buildMoveList({
    duplicates,
    packageName,
    placementConventionRisks: filteredPlacementConventionRisks,
    rootExportRisks: filteredRootExportRisks,
    serviceContractReturns: filteredContractReturns,
    serviceOwnedQueryTypes: filteredServiceOwnedQueryTypes,
    apiQueryServiceTypeImports,
  });
  const phasedPlan = buildPhasedPlan({
    packageName,
    duplicates,
    rootExportRisks: filteredRootExportRisks,
    placementConventionRisks: filteredPlacementConventionRisks,
    serviceContractReturns: filteredContractReturns,
    serviceOwnedQueryTypes: filteredServiceOwnedQueryTypes,
    apiQueryServiceTypeImports,
  });

  return {
    repoRoot,
    scope: packageName ?? 'full-repo',
    scannedPackages,
    authority: buildAuthority(),
    limits: buildLimits(),
    packageSummaries,
    policy: CONTRACT_OWNER_MATRIX,
    crossPackageSummary,
    nonContractCrossImports,
    duplicates,
    apiQueryServiceTypeImports,
    serviceContractReturns: filteredContractReturns,
    placementConventionRisks: filteredPlacementConventionRisks,
    rootExportRisks: filteredRootExportRisks,
    serviceOwnedQueryTypes: filteredServiceOwnedQueryTypes,
    moveList,
    phasedPlan,
  };
}

function buildAuthority() {
  const sourceOfTruth = ['AGENTS.md', 'docs/layers/README.md', 'docs/specs/type-placement.md'];

  return {
    sourceOfTruth,
    enforcedBy: ENFORCED_BY,
    precedence: 'If this audit conflicts with architecture docs or enforced lint/checks, the docs and checks win.',
  };
}

function buildLimits() {
  return {
    heuristicOnly: true,
    noFindingsIsNotProof: true,
    notes: [
      'This script scans declarations, imports, file placement, and selected naming patterns.',
      'It does not perform full semantic ownership analysis.',
      'Declared workspace dependencies are package context, not automatic findings.',
      'Cross-package duplicates in package-local families such as *Input/*Context/*Plan/*Result/*Options/*State/*Config/*App are review-only unless another contract requires a shared owner.',
    ],
  };
}

function buildPackageSummaries(packageContexts, declarations, imports, packageName) {
  const declarationCounts = countBy(declarations, (entry) => entry.packageName);
  const importCounts = countBy(
    imports.filter((entry) => entry.targetPackage !== null && PACKAGE_ORDER.includes(entry.targetPackage)),
    (entry) => entry.packageName,
  );

  return packageContexts
    .filter((entry) => packageName === null || entry.packageName === packageName)
    .map((entry) => ({
      ...entry,
      internalImportCount: importCounts.get(entry.packageName) ?? 0,
      typeDeclarationCount: declarationCounts.get(entry.packageName) ?? 0,
    }));
}

function buildDuplicateTypeNames(declarations, packageName) {
  const grouped = groupBy(declarations, (entry) => entry.name);

  return [...grouped.entries()]
    .filter(([, entries]) => entries.length > 1)
    .filter(([, entries]) => new Set(entries.map((entry) => entry.packageName)).size > 1)
    .filter(([, entries]) => packageName === null || entries.some((entry) => entry.packageName === packageName))
    .map(([name, entries]) => ({
      highSignal: isHighSignalDuplicateName(name, entries),
      name,
      declarations: sortBy(entries, (entry) => `${entry.packageName}:${entry.relativePath}:${entry.line}`),
    }))
    .sort((left, right) => right.declarations.length - left.declarations.length || left.name.localeCompare(right.name));
}

function buildApiQueryServiceTypeImports(imports, packageName) {
  if (packageName !== null && packageName !== 'api') {
    return [];
  }

  return imports.filter(
    (entry) =>
      entry.packageName === 'api' &&
      /^packages\/api\/src\/queries\//.test(entry.relativePath) &&
      /(?:^|\/)\.\.\/services\/.+\.types$/.test(entry.moduleId),
  );
}

function buildCrossPackageSummary(imports, packageContexts) {
  const packageContextByName = new Map(packageContexts.map((entry) => [entry.packageName, entry]));
  const summary = new Map();

  for (const entry of imports) {
    if (entry.targetPackage === null || !PACKAGE_ORDER.includes(entry.targetPackage)) {
      continue;
    }

    const packageContext = packageContextByName.get(entry.packageName);
    const dependencyName = `@compartment/${entry.targetPackage}`;
    const isDeclaredRuntimeDependency = packageContext?.internalDependencies.includes(dependencyName) ?? false;
    const isDeclaredDevDependency = packageContext?.internalDevDependencies.includes(dependencyName) ?? false;
    const sourceSummary = summary.get(entry.packageName) ?? new Map();
    const current = sourceSummary.get(entry.targetPackage) ?? {
      count: 0,
      isDeclaredDevDependency: false,
      isDeclaredRuntimeDependency: false,
    };
    sourceSummary.set(entry.targetPackage, {
      count: current.count + 1,
      isDeclaredDevDependency: current.isDeclaredDevDependency || isDeclaredDevDependency,
      isDeclaredRuntimeDependency: current.isDeclaredRuntimeDependency || isDeclaredRuntimeDependency,
    });
    summary.set(entry.packageName, sourceSummary);
  }

  return [...summary.entries()]
    .sort(([left], [right]) => PACKAGE_ORDER.indexOf(left) - PACKAGE_ORDER.indexOf(right))
    .map(([sourcePackage, targets]) => ({
      sourcePackage,
      targets: [...targets.entries()]
        .sort(([left], [right]) => PACKAGE_ORDER.indexOf(left) - PACKAGE_ORDER.indexOf(right))
        .map(([targetPackage, value]) => ({
          count: value.count,
          isDeclaredDevDependency: value.isDeclaredDevDependency,
          isDeclaredRuntimeDependency: value.isDeclaredRuntimeDependency,
          targetPackage,
        })),
    }));
}

function buildMoveList(input) {
  const items = [];

  for (const declaration of input.serviceOwnedQueryTypes) {
    items.push({
      category: 'move-to-query-layer',
      reason: `${declaration.name} looks query-owned but is declared under services`,
      target: `${declaration.relativePath}:${declaration.line}`,
      action: `Move ${declaration.name} into an adjacent query-owned *.types.ts module and stop importing it from services.`,
    });
  }

  for (const entry of input.apiQueryServiceTypeImports) {
    const imported = entry.importedNames.length > 0 ? entry.importedNames.join(', ') : 'service-owned types';
    items.push({
      category: 'remove-query-service-leak',
      reason: `${entry.relativePath}:${entry.line} imports ${imported} from ${entry.moduleId}`,
      target: `${entry.relativePath}:${entry.line}`,
      action:
        'Move the imported query-owned shapes beside the query or boundary that owns them, then replace the service-layer import.',
    });
  }

  for (const entry of input.serviceContractReturns) {
    if (entry.packageName !== 'api') {
      continue;
    }

    items.push({
      category: 'move-response-shaping-to-boundary',
      reason: `${entry.functionName} returns contract type ${entry.contractType}`,
      target: `${entry.relativePath}:${entry.line}`,
      action: `Keep ${entry.functionName} on a local service result type and shape ${entry.contractType} at the route or transport boundary.`,
    });
  }

  for (const risk of input.placementConventionRisks) {
    items.push({
      category: 'fix-placement-convention',
      reason: `${risk.relativePath} ${risk.reason}`,
      target: risk.relativePath,
      action: risk.action,
    });
  }

  for (const duplicate of input.duplicates.filter((entry) => entry.highSignal)) {
    items.push({
      category: 'resolve-duplicate-name',
      reason: `${duplicate.name} is declared in ${duplicate.declarations.length} places`,
      target: duplicate.declarations.map((entry) => `${entry.relativePath}:${entry.line}`).join(', '),
      action: `Review whether ${duplicate.name} needs one shared owner or a clearer rename; keep duplicates only when the type is intentionally package-local.`,
    });
  }

  for (const risk of input.rootExportRisks) {
    items.push({
      category: 'narrow-root-export-surface',
      reason: `${risk.relativePath}:${risk.line} ${risk.reasons.join('; ')}`,
      target: `${risk.relativePath}:${risk.line}`,
      action:
        'Replace the broad root export with explicit entrypoints or remove the type-heavy re-export from the package root.',
    });
  }

  return dedupeBy(items, (entry) => `${entry.category}:${entry.target}:${entry.action}`);
}

function buildPhasedPlan(input) {
  const phases = [];

  if (input.apiQueryServiceTypeImports.length > 0 || input.serviceOwnedQueryTypes.length > 0) {
    phases.push({
      title: 'Phase 1',
      summary: 'Move query-owned shapes out of services and remove api query/service type leakage first.',
    });
  }

  if (input.serviceContractReturns.length > 0) {
    phases.push({
      title: phases.length === 0 ? 'Phase 1' : `Phase ${phases.length + 1}`,
      summary:
        'Localize service result types and move contract response shaping back to the route or transport boundary.',
    });
  }

  if (input.placementConventionRisks.length > 0) {
    phases.push({
      title: phases.length === 0 ? 'Phase 1' : `Phase ${phases.length + 1}`,
      summary: 'Fix file placement and naming first so future type moves keep the owning layer obvious.',
    });
  }

  if (input.duplicates.some((entry) => entry.highSignal) || input.rootExportRisks.length > 0) {
    phases.push({
      title: phases.length === 0 ? 'Phase 1' : `Phase ${phases.length + 1}`,
      summary:
        'Resolve duplicate names, then narrow package root exports so the runtime surface matches the true owner packages.',
    });
  }

  phases.push({
    title: phases.length === 0 ? 'Phase 1' : `Phase ${phases.length + 1}`,
    summary: `Rerun this audit${input.packageName === null ? '' : ` for ${input.packageName}`} and then run the relevant package checks plus any special checks the diff needs before commit-time repo checks start automatically.`,
  });

  return phases;
}

function renderMarkdown(report) {
  const packages = report.scannedPackages.join(', ');
  const sourceOfTruth = report.authority.sourceOfTruth.map((entry) => `\`${entry}\``).join(', ');
  const lines = [
    '# Type Ownership Audit',
    '',
    `Scope: ${report.scope}`,
    `Packages: ${packages}`,
    '',
    '## Policy',
    ...report.policy.map((entry) => `- \`${entry.owner}\`: ${entry.rule}`),
    '',
    '## Authority',
    `- Source of truth: ${sourceOfTruth}`,
    `- Enforced by: ${report.authority.enforcedBy.map((entry) => `\`${entry}\``).join(', ')}`,
    `- ${report.authority.precedence}`,
    '',
    '## Limits',
    '- This audit is heuristic only.',
    '- No findings matched by the current heuristics is not proof that ownership is correct.',
    ...report.limits.notes.map((entry) => `- ${entry}`),
    '',
    '## Concrete Findings',
    '',
    '### Package Context',
    '| Package | Types | Compartment imports | Runtime deps | Dev deps |',
    '| --- | ---: | ---: | --- | --- |',
    ...report.packageSummaries.map(
      (entry) =>
        `| ${entry.packageName} | ${entry.typeDeclarationCount} | ${entry.internalImportCount} | ${formatList(entry.internalDependencies)} | ${formatList(entry.internalDevDependencies)} |`,
    ),
    '',
    '### Cross-Package Imports',
    ...renderCrossPackageSummary(report.crossPackageSummary),
    '',
    '### Duplicate Type Names',
    ...renderDuplicates(report.duplicates),
    '',
    '### API Query Imports From Services Types',
    ...renderImportFindings(report.apiQueryServiceTypeImports),
    '',
    '### Service Functions Returning Contract Response or Summary Types',
    ...renderContractReturnFindings(report.serviceContractReturns),
    '',
    '### Placement Convention Risks',
    ...renderPlacementConventionRisks(report.placementConventionRisks),
    '',
    '### Root Export Risks',
    ...renderRootExportRisks(report.rootExportRisks),
    '',
    '## Move List',
    ...renderMoveList(report.moveList),
    '',
    '## Phased Refactor Plan',
    ...report.phasedPlan.map((phase) => `- ${phase.title}: ${phase.summary}`),
    '',
  ];

  return lines.join('\n');
}

function renderCrossPackageSummary(entries) {
  if (entries.length === 0) {
    return ['- No cross-package imports matched the current heuristics in scope.'];
  }

  const lines = entries.map(
    (entry) =>
      `- \`${entry.sourcePackage}\`: ${entry.targets
        .map((target) => `${target.targetPackage} (${target.count}; ${formatDependencyStatus(target)})`)
        .join(', ')}`,
  );

  const interesting = entries.flatMap((entry) =>
    entry.targets
      .filter((target) => target.targetPackage !== 'contracts' && !target.isDeclaredRuntimeDependency)
      .map(
        (target) =>
          `- \`${entry.sourcePackage}\` -> \`${target.targetPackage}\`: ${target.count} (${formatDependencyStatus(target)})`,
      ),
  );

  return interesting.length > 0
    ? [...lines, '', 'Potential dependency declaration mismatches:', ...interesting]
    : lines;
}

function renderDuplicates(entries) {
  if (entries.length === 0) {
    return ['- No duplicate type names matched the current heuristics in scope.'];
  }

  return entries.map(
    (entry) =>
      `- \`${entry.name}\`${entry.highSignal ? '' : ' (review-only package-local duplicate family)'}: ${entry.declarations
        .map((declaration) => `${declaration.packageName} at ${declaration.relativePath}:${declaration.line}`)
        .join('; ')}`,
  );
}

function renderImportFindings(entries) {
  if (entries.length === 0) {
    return ['- No query/http/route imports from `services/*.types` matched the current heuristics in scope.'];
  }

  return entries.map(
    (entry) =>
      `- ${entry.relativePath}:${entry.line}: imports ${entry.importedNames.length > 0 ? entry.importedNames.join(', ') : 'types'} from \`${entry.moduleId}\``,
  );
}

function renderContractReturnFindings(entries) {
  if (entries.length === 0) {
    return [
      '- No service functions returning contract `*Response` or `*Summary` types matched the current heuristics in scope.',
    ];
  }

  return entries.map(
    (entry) =>
      `- ${entry.relativePath}:${entry.line}: \`${entry.functionName}\` returns \`${entry.returnType}\` via contract type \`${entry.contractType}\``,
  );
}

function renderPlacementConventionRisks(entries) {
  if (entries.length === 0) {
    return ['- No placement convention risks matched the current heuristics in scope.'];
  }

  return entries.map((entry) => `- ${entry.relativePath}: ${entry.reason}`);
}

function renderRootExportRisks(entries) {
  if (entries.length === 0) {
    return ['- No root export risks matched the current heuristics in scope.'];
  }

  return entries.map(
    (entry) => `- ${entry.relativePath}:${entry.line}: ${entry.reasons.join('; ')}. Statement: \`${entry.statement}\``,
  );
}

function renderMoveList(entries) {
  if (entries.length === 0) {
    return ['- No move suggestions matched the current heuristics in scope.'];
  }

  return entries.map((entry) => `- [${entry.category}] ${entry.action} Source: ${entry.target}`);
}

function formatDependencyStatus(target) {
  if (target.isDeclaredRuntimeDependency) {
    return target.isDeclaredDevDependency ? 'declared dep + devDependency' : 'declared dep';
  }
  if (target.isDeclaredDevDependency) {
    return 'devDependency only';
  }

  return 'undeclared';
}

function isHighSignalDuplicateName(name, declarations) {
  return (
    new Set(declarations.map((entry) => entry.packageName)).size > 1 && !PACKAGE_LOCAL_DUPLICATE_NAME_PATTERN.test(name)
  );
}

function readImportedContractReturnTypes(sourceText) {
  const imports = [...sourceText.matchAll(/import[\s\S]*?from\s+['"]@compartment\/contracts['"];?/g)];
  const importedNames = imports.flatMap((match) => parseNamedImports(match[0]));

  return dedupeBy(
    importedNames.filter((name) => /(?:Response|Summary)$/.test(name)),
    (name) => name,
  );
}

function parseNamedImports(statement) {
  const match = statement.match(/{([\s\S]*?)}/);
  if (match === null) {
    return [];
  }

  return match[1]
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map(
      (part) =>
        part
          .replace(/^type\s+/, '')
          .split(/\s+as\s+/)[0]
          ?.trim() ?? '',
    )
    .filter((part) => part !== '');
}

function parsePlacementConventionRisks(repoRoot, packageName, filePath) {
  const relativePath = toRepoPath(repoRoot, filePath);
  const risks = [];

  if (relativePath.includes('/src/types/')) {
    risks.push({
      packageName,
      relativePath,
      reason: 'uses a generic src/types bucket',
      action:
        'Move the file to the owning layer instead of using src/types, for example queries/*.query.types.ts, services/*.service.types.ts, routes/**/.presenter.ts, store/*.types.ts, output/*.types.ts, or client/request support modules.',
    });
  }

  if (/^packages\/[^/]+\/src\/routes\/shared\//.test(relativePath)) {
    risks.push({
      packageName,
      relativePath,
      reason: 'uses routes/shared, which is not an ownership rule',
      action:
        'Move the presenter beside the owning route group or into routes/presenters only when it is genuinely cross-feature.',
    });
  }

  if (
    /^packages\/[^/]+\/src\/routes\//.test(relativePath) &&
    relativePath.endsWith('.ts') &&
    relativePath.endsWith('response.ts')
  ) {
    risks.push({
      packageName,
      relativePath,
      reason: 'uses a *response.ts filename in the route layer',
      action:
        'Rename the mapper to *.presenter.ts; response types and schemas belong in contracts, not in runtime package files.',
    });
  }

  return risks;
}

function startsImportOrExportBlock(line) {
  return /^import\s/.test(line) || /^export\s{/.test(line);
}

function endsImportOrExportBlock(line) {
  return /\sfrom\s+['"][^'"]+['"];?$/.test(line) || line.endsWith(';');
}

function readWorkspaceDependencies(dependencies) {
  return Object.keys(dependencies)
    .filter((name) => name.startsWith('@compartment/'))
    .sort();
}

function countExternalDependencies(dependencies) {
  return Object.keys(dependencies).filter((name) => !name.startsWith('@compartment/')).length;
}

function isServiceImplementationFile(filePath) {
  return filePath.includes('/services/') && !filePath.endsWith('.types.ts');
}

function isRootIndexFile(filePath) {
  return /\/src\/index\.ts$/.test(filePath);
}

function toRepoPath(repoRoot, filePath) {
  return relative(repoRoot, filePath).split('\\').join('/');
}

function readLineNumber(sourceText, index) {
  return sourceText.slice(0, index).split('\n').length;
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function filterByPackage(entries, packageName, ...selectors) {
  if (packageName === null) {
    return entries;
  }

  return entries.filter((entry) => selectors.some((selector) => selector(entry) === packageName));
}

function groupBy(entries, selector) {
  const grouped = new Map();

  for (const entry of entries) {
    const key = selector(entry);
    const bucket = grouped.get(key) ?? [];
    bucket.push(entry);
    grouped.set(key, bucket);
  }

  return grouped;
}

function countBy(entries, selector) {
  const counted = new Map();

  for (const entry of entries) {
    const key = selector(entry);
    counted.set(key, (counted.get(key) ?? 0) + 1);
  }

  return counted;
}

function sortBy(entries, selector) {
  return [...entries].sort((left, right) => selector(left).localeCompare(selector(right)));
}

function dedupeBy(entries, selector) {
  const seen = new Set();
  const deduped = [];

  for (const entry of entries) {
    const key = selector(entry);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(entry);
  }

  return deduped;
}

function formatList(values) {
  return values.length > 0 ? values.join(', ') : '-';
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
