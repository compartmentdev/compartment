import type { ApiApp } from '../../app.types';
import { registerDeleteProjectRoute } from './delete-project.route';
import { registerGetProjectRoute } from './get-project.route';
import { registerGetProjectOverviewRoute } from './get-project-overview.route';
import { registerGetProjectsRoute } from './get-projects.route';
import { registerPatchProjectRoute } from './patch-project.route';
import { registerPostArchiveProjectRoute } from './post-archive-project.route';
import { registerPostStartProjectRoute } from './post-start-project.route';
import { registerPostStopProjectRoute } from './post-stop-project.route';
import { registerPostUnarchiveProjectRoute } from './post-unarchive-project.route';

export function registerProjectRoutes(app: ApiApp): void {
  registerGetProjectsRoute(app);
  registerDeleteProjectRoute(app);
  registerGetProjectOverviewRoute(app);
  registerGetProjectRoute(app);
  registerPatchProjectRoute(app);
  registerPostArchiveProjectRoute(app);
  registerPostStartProjectRoute(app);
  registerPostStopProjectRoute(app);
  registerPostUnarchiveProjectRoute(app);
}
