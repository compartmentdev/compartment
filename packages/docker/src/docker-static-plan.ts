import { readFile, writeFile } from 'node:fs/promises';

const staticBuildStepName: string = 'build';
const staticStartCommand: string = 'cd /app && caddy run --config /app/Caddyfile --adapter caddyfile 2>&1';

type RailpackPlanJsonValue = boolean | null | number | RailpackPlanJsonObject | RailpackPlanJsonValue[] | string;

interface RailpackPlanJsonObject {
  [key: string]: RailpackPlanJsonValue;
}

type RailpackPlanRecord = RailpackPlanJsonObject;
type RailpackPlanDocument = RailpackPlanRecord & {
  deploy?: RailpackDeploySection | undefined;
};
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

  plan.deploy = {
    ...deploy,
    inputs: normalizeStaticDeployInputs(deploy.inputs ?? [], staticOutputDirectory),
    startCommand: staticStartCommand,
  };

  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
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
): RailpackDeployInput[] {
  const normalizedStaticOutputInput: RailpackDeployInput = {
    include: [staticOutputDirectory],
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
