import type { ApiApp } from '../../app.types';
import { stopProjectForPrincipal } from '../../services/project-lifecycle.service';
import { registerPostProjectLifecycleRoute } from './project-lifecycle-route.helpers';
import { projectStopApiPathname } from './projects-api-paths';

export function registerPostStopProjectRoute(app: ApiApp): void {
  registerPostProjectLifecycleRoute(app, projectStopApiPathname, stopProjectForPrincipal);
}
