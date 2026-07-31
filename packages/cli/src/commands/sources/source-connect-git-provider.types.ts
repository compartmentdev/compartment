import type {
  GitProviderRegistrationSummary,
  GitProviderRepositorySummary,
  GitProviderType,
} from '@compartment/contracts';
import type { AuthenticatedContext } from '../../services/context.types';
import type { LocalGitSourcePlan } from '../../services/source-git-local.service.types';
import type { CliCommandDependencies } from '../command.types';

export type GitSourceProviderOption = 'github' | 'gitlab';

export interface GitSourceRepositorySelection {
  providerHost: string;
  registrationId: string;
  repository: GitProviderRepositorySummary;
}

export interface GitSourceSelectionInput {
  context: AuthenticatedContext;
  dependencies: CliCommandDependencies;
  plan: LocalGitSourcePlan;
  registrations: GitProviderRegistrationSummary[];
}

export interface GitSourceProviderDescriptor {
  providerType: GitProviderType;
  selectRepository: (input: GitSourceSelectionInput) => Promise<GitSourceRepositorySelection>;
}
