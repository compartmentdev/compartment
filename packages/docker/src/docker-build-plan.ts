import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RailpackPlanPaths } from './docker-build.types';

const sourceBuildToolchainPrewarmPackageJson: string = `${JSON.stringify(
  {
    name: 'compartment-source-build-prewarm',
    private: true,
    scripts: {
      start: 'node server.mjs',
    },
  },
  null,
  2,
)}\n`;
const sourceBuildToolchainPrewarmServerFile: string = "console.log('compartment source build prewarm');\n";

export function buildRailpackPlanPaths(directory: string): RailpackPlanPaths {
  return {
    infoPath: join(directory, 'railpack-info.json'),
    planPath: join(directory, 'railpack-plan.json'),
  };
}

export async function writeSourceBuildToolchainPrewarmFixture(prewarmDirectory: string): Promise<void> {
  await writeFile(join(prewarmDirectory, 'package.json'), sourceBuildToolchainPrewarmPackageJson);
  await writeFile(join(prewarmDirectory, 'server.mjs'), sourceBuildToolchainPrewarmServerFile);
}
