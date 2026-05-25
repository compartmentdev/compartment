import type { CliCommandCapture } from './cli-test.harness';

export type CliTestCapture = CliCommandCapture;

export interface CliOrgUsePayload {
  organization: {
    slug: string;
  };
}
