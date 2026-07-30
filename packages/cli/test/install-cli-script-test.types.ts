export interface ExecFileFailure extends Error {
  code?: number | string | undefined;
  stderr?: Buffer | string | undefined;
  stdout?: Buffer | string | undefined;
}

export interface ExecFileSuccess {
  stderr: string;
  stdout: string;
}

export interface InstallerFixture {
  artifactName: string;
  checksumsPath: string;
  tarballPath: string;
}

export type InstallerSignatureOutcome = 'foreign-identity' | 'unsigned' | 'valid' | 'wrong-workflow-sha';
export type OrasResolveOutcome = 'missing' | 'unavailable' | 'valid';
export type PublishedFallbackOutcome = 'lookup-missing' | 'resolve-missing' | 'signature-invalid' | 'valid';

export interface InstallerScriptResult {
  compartmentInvocations: string[];
  cosignInvocations: string[];
  exitCode: number | string;
  installerTerminalOutput: string;
  orasInvocations: string[];
  stderr: string;
  stdout: string;
  sudoInvocations: string[];
  urlLog: string[];
}

export interface InstallerRunOptions {
  acceptPathUpdate?: boolean | undefined;
  allowFailure?: boolean | undefined;
  archName?: string | undefined;
  args: string[];
  binDir?: string | undefined;
  defaultVersion?: string | undefined;
  installerTerminalOutputPath?: string | undefined;
  installerTerminalPath?: string | undefined;
  orasResolveOutcome?: OrasResolveOutcome | undefined;
  osName?: string | undefined;
  pathEntries?: string[] | undefined;
  publishedFallbackOutcome?: PublishedFallbackOutcome | undefined;
  shell?: string | undefined;
  signatureOutcome?: InstallerSignatureOutcome | undefined;
  toolVersionMode?: 'compatible' | 'incompatible' | undefined;
}

export interface InstallerProcessResult {
  exitCode: number | string;
  stderr: string;
  stdout: string;
}

export interface ShellProfileCase {
  command: (temporaryDirectory: string) => string;
  osName?: string | undefined;
  profile: (temporaryDirectory: string) => string;
  shell: string;
}
