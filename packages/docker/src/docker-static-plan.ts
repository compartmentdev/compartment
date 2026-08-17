import { readFile, writeFile } from 'node:fs/promises';
import { posix } from 'node:path';

const railpackAppDirectory: string = '/app';
const staticCaddyfileAssetName: string = 'Caddyfile';
const staticBuildStepName: string = 'build';

type RailpackPlanJsonValue = boolean | null | number | RailpackPlanJsonObject | RailpackPlanJsonValue[] | string;

interface RailpackPlanJsonObject {
  [key: string]: RailpackPlanJsonValue;
}

type RailpackPlanRecord = RailpackPlanJsonObject;
type RailpackPlanDocument = RailpackPlanRecord & {
  deploy?: RailpackDeploySection | undefined;
  steps?: RailpackBuildStep[] | undefined;
};
type RailpackBuildCommand = RailpackPlanRecord & {
  name?: string | undefined;
  path?: string | undefined;
};
type RailpackBuildStep = RailpackPlanRecord & {
  commands?: RailpackBuildCommand[] | undefined;
  name?: string | undefined;
};
interface RailpackCaddyfileArtifact {
  path: string;
  stepName: string;
}
type RailpackDeploySection = RailpackPlanRecord & {
  inputs?: RailpackDeployInput[] | undefined;
  startCommand?: string | undefined;
};
type RailpackDeployInput = RailpackPlanRecord & {
  include?: string[] | undefined;
  step?: string | undefined;
};

export async function normalizeStaticRailpackPlan(planPath: string, staticOutputDirectory: string): Promise<void> {
  const plan: RailpackPlanDocument = parseRailpackPlan(await readFile(planPath, 'utf8'));
  const deploy: RailpackDeploySection = readRailpackDeploySection(plan);
  const caddyfileArtifact: RailpackCaddyfileArtifact = readCaddyfileArtifact(plan.steps ?? []);

  plan.deploy = {
    ...deploy,
    inputs: normalizeStaticDeployInputs(deploy.inputs ?? [], staticOutputDirectory, caddyfileArtifact),
    startCommand: buildStaticStartCommand(readShippedCaddyfilePath(caddyfileArtifact)),
  };

  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
}

function readCaddyfileArtifact(steps: readonly RailpackBuildStep[]): RailpackCaddyfileArtifact {
  for (const step of steps) {
    const caddyfileCommand: RailpackBuildCommand | undefined = step.commands?.find(
      (command: RailpackBuildCommand): boolean => command.name === staticCaddyfileAssetName,
    );
    if (caddyfileCommand?.path !== undefined && step.name !== undefined) {
      return { path: caddyfileCommand.path, stepName: step.name };
    }
  }

  throw new Error('Expected Railpack static plan to define the Caddyfile artifact and owning step.');
}

function readShippedCaddyfilePath(caddyfileArtifact: RailpackCaddyfileArtifact): string {
  return posix.resolve(railpackAppDirectory, caddyfileArtifact.path);
}

function buildStaticStartCommand(caddyfilePath: string): string {
  return `cd ${railpackAppDirectory} && caddy run --config ${caddyfilePath} --adapter caddyfile 2>&1`;
}

function parseRailpackPlan(planText: string): RailpackPlanDocument {
  const parsedPlan: RailpackPlanJsonValue = JSON.parse(planText) as RailpackPlanJsonValue;
  if (!isRailpackPlanDocument(parsedPlan)) {
    throw new Error('Expected Railpack plan output to be a JSON object.');
  }

  return parsedPlan;
}

function isRailpackPlanDocument(value: RailpackPlanJsonValue): value is RailpackPlanDocument {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRailpackDeploySection(plan: RailpackPlanDocument): RailpackDeploySection {
  const deploy: RailpackDeploySection | undefined = plan.deploy;
  if (deploy === undefined) {
    throw new Error('Expected Railpack plan to define a deploy section for static packaging.');
  }

  return deploy;
}

function normalizeStaticDeployInputs(
  inputs: readonly RailpackDeployInput[],
  staticOutputDirectory: string,
  caddyfileArtifact: RailpackCaddyfileArtifact,
): RailpackDeployInput[] {
  const normalizedStaticOutputInput: RailpackDeployInput = {
    include: [
      staticOutputDirectory,
      ...(caddyfileArtifact.stepName === staticBuildStepName ? [caddyfileArtifact.path] : []),
    ],
    step: staticBuildStepName,
  };
  const preservedInputs: RailpackDeployInput[] = inputs.filter(
    (input: RailpackDeployInput): boolean => !isBuildDeployInput(input),
  );

  return [...preservedInputs, normalizedStaticOutputInput];
}

function isBuildDeployInput(input: RailpackDeployInput): boolean {
  return input.step === staticBuildStepName;
}
