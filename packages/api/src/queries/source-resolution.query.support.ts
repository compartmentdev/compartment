import { eq, or, type SQL } from 'drizzle-orm';
import { sourceResolutionTasks } from '../db/schema';

export function buildNonTerminalSourceResolutionTaskStatusFilter(): SQL {
  return or(eq(sourceResolutionTasks.status, 'pending'), eq(sourceResolutionTasks.status, 'claimed'))!;
}
