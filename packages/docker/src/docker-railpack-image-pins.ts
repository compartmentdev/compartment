import { readFile, writeFile } from 'node:fs/promises';

type RailpackPlanValue = boolean | null | number | RailpackPlanObject | RailpackPlanValue[] | string;

interface RailpackPlanObject {
  [key: string]: RailpackPlanValue;
}

const railpackImagePins: Readonly<Record<string, string>> = Object.freeze({
  'ghcr.io/railwayapp/railpack-builder:mise-2026.3.17':
    'ghcr.io/railwayapp/railpack-builder@sha256:d2e547fbb30d50ef9b2c4c3affc2a1946028c4bac3b112d9fd0cb7537604391a',
  'ghcr.io/railwayapp/railpack-runtime:mise-2026.3.17':
    'ghcr.io/railwayapp/railpack-runtime@sha256:e54feace425e977ef6bf9cdf5a80640a2e88239ad14ee6ead20877483fff6b9f',
});
const pinnedRailpackImages: ReadonlySet<string> = new Set<string>(Object.values(railpackImagePins));
const railpackImageRepositories: readonly string[] = [
  'ghcr.io/railwayapp/railpack-builder',
  'ghcr.io/railwayapp/railpack-runtime',
];

export async function pinRailpackPlanImages(planPath: string): Promise<void> {
  const plan: RailpackPlanValue = JSON.parse(await readFile(planPath, 'utf8')) as RailpackPlanValue;
  if (typeof plan !== 'object' || plan === null || Array.isArray(plan)) {
    throw new Error('Expected Railpack plan output to be a JSON object.');
  }
  pinRailpackContainer(plan);
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
}

function pinRailpackContainer(value: RailpackPlanObject | RailpackPlanValue[]): void {
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === 'string') {
      const pinned: string = resolvePinnedRailpackImage(child);
      if (Array.isArray(value)) {
        value[Number.parseInt(key, 10)] = pinned;
      } else {
        value[key] = pinned;
      }
    } else if (typeof child === 'object' && child !== null) {
      pinRailpackContainer(child);
    }
  }
}

function resolvePinnedRailpackImage(image: string): string {
  const pinned: string | undefined = railpackImagePins[image];
  if (pinned !== undefined) {
    return pinned;
  }
  if (
    !pinnedRailpackImages.has(image) &&
    railpackImageRepositories.some(
      (repository: string): boolean => image.startsWith(`${repository}:`) || image.startsWith(`${repository}@`),
    )
  ) {
    throw new Error(`Railpack generated an image without an approved immutable pin: ${image}`);
  }
  return image;
}
