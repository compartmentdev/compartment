---
title: Connect GitLab repositories
description: Connect gitlab.com or a trusted self-managed GitLab host with an access token.
---

Use the GitLab path when your repository is hosted on GitLab. The Console asks for the GitLab host and an access token, then lists projects that the token can manage.

## Token requirements

Create a personal access token with the `api` scope. Its user needs Maintainer access to each project you want to connect. Maintainer access is required for webhook creation; lower-access projects are not shown in the repository picker. GitLab.com tokens expire; self-managed GitLab can allow a token without an expiry. When an expiry exists, rotate the token before that date.

For a self-managed host, add the hostname to `COMPARTMENT_TRUSTED_OUTBOUND_HOSTS` for both the API and worker services before connecting.

## Connect and rotate

In the Console onboarding, choose **GitLab**, enter the host and token, and continue to repositories. If the repository has no descriptor, Compartment opens a merge request. It includes starter app files only when the repository does not already look like an application repository.

To rotate a token, re-enter it in the GitLab form or run the connect command again with `COMPARTMENT_GITLAB_TOKEN` set. Registration identity follows the GitLab user ID, so changing that user's username does not create a second identity.

If the token expires or is revoked, Compartment fails fast and shows the error. Repository reads and deploys remain unavailable until you enter a valid token; there is no silent recovery.

## CLI provider detection

The CLI resolves the provider in this order:

- explicit `--provider github|gitlab`;
- a registration whose host matches the Git remote;
- `github.com` or `gitlab.com`;
- otherwise an error asking you to pass `--provider` or register the provider.

Set `COMPARTMENT_GITLAB_TOKEN` when the CLI needs to create or rotate a GitLab registration.

Subgroup paths such as `group/platform/project` are supported over HTTPS, `ssh://`, and SCP-style Git remotes.

## Limits and security

Repository listing and recursive tree reads fail after 50 GitLab API pages of 100 results. Reduce the machine user's project access or repository tree size if you hit that safety cap.

Compartment stores the PAT encrypted. Workers use it to download repository archives for deploys. Prefer a dedicated machine user and grant it Maintainer access only to the projects Compartment must deploy.
