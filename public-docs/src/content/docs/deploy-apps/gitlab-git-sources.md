---
title: Connect GitLab repositories
description: Connect gitlab.com or a trusted self-managed GitLab host with an access token.
---

Use the GitLab path when your repository is hosted on GitLab. The Console asks for the GitLab host and an access token, then lists projects that the token can manage.

## Token requirements

Create a personal or project access token with the `api` scope and Maintainer access to the project. Maintainer access is required for webhook creation; projects below Maintainer level are not shown in the repository picker.

For a self-managed host, add the hostname to `COMPARTMENT_TRUSTED_OUTBOUND_HOSTS` for both the API and worker services before connecting.

## Connect and rotate

In the Console onboarding, choose **GitLab**, enter the host and token, and continue to repositories. If the repository has no descriptor, Compartment opens a merge request with the starter files.

To rotate a token, submit the GitLab form again or run the connect command again with `COMPARTMENT_GITLAB_TOKEN` set. The existing registration is rotated in place and its webhook remains connected.

If the token is revoked, repository reads and deploys fail until you re-enter a valid token. The Console shows **Re-enter token**.

## CLI provider detection

The CLI uses this matrix:

- `github.com` -> GitHub;
- `gitlab.com` -> GitLab;
- a host with an active GitLab registration -> GitLab;
- a token set and the host not active for GitHub -> GitLab;
- otherwise -> GitHub.

Set `COMPARTMENT_GITLAB_TOKEN` when the CLI needs to create or rotate a GitLab registration.
