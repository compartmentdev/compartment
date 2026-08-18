import { readFile, writeFile } from 'node:fs/promises';
import type { DockerRailpackImages } from './docker-railpack-images.types';
import type {
  RailpackPlan,
  RailpackPlanInput,
  RailpackPlanJsonObject,
  RailpackPlanJsonValue,
  RailpackPinnedImage,
  RailpackPinnedImageCounts,
  RailpackResolvedImages,
  RailpackPlanStep,
} from './railpack-plan-image-pinning.types';

const builderRepository: string = 'ghcr.io/railwayapp/railpack-builder';
const runtimeRepository: string = 'ghcr.io/railwayapp/railpack-runtime';
const digestImagePattern: RegExp = /^(.+):([^@/:]+)@sha256:[a-f0-9]{64}$/u;

export async function pinRailpackPlanImages(planPath: string, images: DockerRailpackImages): Promise<void> {
  const builder: RailpackPinnedImage = readPinnedImage(images.builder, builderRepository);
  const runtime: RailpackPinnedImage = readPinnedImage(images.runtime, runtimeRepository);
  const plan: RailpackPlan = parseRailpackPlan(await readFile(planPath, 'utf8'));
  const counts: RailpackPinnedImageCounts = pinPlanInputs(plan.steps, { builder, runtime });
  if (counts.builder === 0) {
    throw new Error('Railpack plan must reference the configured builder image repository.');
  }
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
}

function pinPlanInputs(steps: readonly RailpackPlanStep[], images: RailpackResolvedImages): RailpackPinnedImageCounts {
  const counts: RailpackPinnedImageCounts = { builder: 0, runtime: 0 };
  for (const step of steps) {
    for (const input of step.inputs ?? []) {
      pinPlanInput(input, images, counts);
    }
  }
  return counts;
}

function pinPlanInput(
  input: RailpackPlanInput,
  images: RailpackResolvedImages,
  counts: RailpackPinnedImageCounts,
): void {
  if (referencesRepository(input.image, builderRepository)) {
    assertExpectedPlanImage(input.image, images.builder);
    input.image = images.builder.pinned;
    counts.builder += 1;
  } else if (referencesRepository(input.image, runtimeRepository)) {
    assertExpectedPlanImage(input.image, images.runtime);
    input.image = images.runtime.pinned;
    counts.runtime += 1;
  }
}

function referencesRepository(image: string | undefined, repository: string): boolean {
  return image?.startsWith(`${repository}:`) === true || image?.startsWith(`${repository}@`) === true;
}

function readPinnedImage(image: string, repository: string): RailpackPinnedImage {
  const match: RegExpExecArray | null = digestImagePattern.exec(image);
  if (match?.[1] !== repository) {
    throw new Error(`Railpack image must pin ${repository} by tag and digest.`);
  }
  return { pinned: image, repository, tagged: `${repository}:${match[2]}` };
}

function assertExpectedPlanImage(image: string | undefined, expected: RailpackPinnedImage): void {
  if (image !== expected.tagged && image !== expected.pinned) {
    throw new Error(`Railpack plan referenced ${String(image)}; expected ${expected.tagged}.`);
  }
}

function parseRailpackPlan(value: string): RailpackPlan {
  const parsed: RailpackPlanJsonValue = JSON.parse(value) as RailpackPlanJsonValue;
  return readRailpackPlan(parsed);
}

function readRailpackPlan(value: RailpackPlanJsonValue): RailpackPlan {
  if (!isRecord(value) || !Array.isArray(value.steps)) {
    throw new Error('Railpack emitted an invalid plan.');
  }
  const steps: RailpackPlanStep[] = value.steps.map(readRailpackPlanStep);
  return { ...value, steps };
}

function readRailpackPlanStep(value: RailpackPlanJsonValue): RailpackPlanStep {
  if (!isRecord(value) || (value.inputs !== undefined && !Array.isArray(value.inputs))) {
    throw new Error('Railpack emitted an invalid plan step.');
  }
  return {
    ...value,
    ...(value.inputs === undefined ? {} : { inputs: value.inputs.map(readRailpackPlanInput) }),
  };
}

function readRailpackPlanInput(value: RailpackPlanJsonValue): RailpackPlanInput {
  if (!isRecord(value) || (value.image !== undefined && typeof value.image !== 'string')) {
    throw new Error('Railpack emitted an invalid plan input.');
  }
  return { ...value };
}

function isRecord(value: RailpackPlanJsonValue): value is RailpackPlanJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
