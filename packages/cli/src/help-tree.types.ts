export interface CliHelpTreeNode {
  helpText: string;
  pathSegments: readonly string[];
  subcommands: readonly CliHelpTreeNode[];
}
