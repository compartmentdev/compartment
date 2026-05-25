import type { ApiApp } from '../../app.types';
import { startProjectForPrincipal } from '../../services/project-lifecycle.service';
import { registerPostProjectLifecycleRoute } from './project-lifecycle-route.helpers';
import { projectStartApiPathname } from './projects-api-paths';

export function registerPostStartProjectRoute(app: ApiApp): void {
  registerPostProjectLifecycleRoute(app, projectStartApiPathname, startProjectForPrincipal);
}
