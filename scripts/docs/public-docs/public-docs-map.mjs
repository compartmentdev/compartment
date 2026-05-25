import { publicDocsAreas as publicDocsAreaDefinitions } from './public-docs-areas.mjs';

const publicDocsAreas = publicDocsAreaDefinitions;

export function findPublicDocsAreaByCliRoot(cliRoot) {
  return publicDocsAreas.find((area) => area.cliRoots.includes(cliRoot)) ?? null;
}

export function findImpactedPublicDocsAreas(paths) {
  return publicDocsAreas.filter((area) => {
    return needsGuideUpdate(area, paths) || needsGeneratedUpdate(area, paths);
  });
}

function needsGuideUpdate(area, paths) {
  return matchesAnyPath(paths, area.guideSourcePatterns);
}

function needsGeneratedUpdate(area, paths) {
  return matchesAnyPath(paths, area.generatedSourcePatterns);
}

function matchesAnyPath(paths, patterns) {
  return paths.some((path) => patterns.some((pattern) => pattern.test(path)));
}
