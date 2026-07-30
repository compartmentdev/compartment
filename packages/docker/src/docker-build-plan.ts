import { join } from 'node:path';
import type { RailpackPlanPaths } from './docker-build.types';

export function buildRailpackPlanPaths(directory: string): RailpackPlanPaths {
  return {
    infoPath: join(directory, 'railpack-info.json'),
    planPath: join(directory, 'railpack-plan.json'),
  };
}
