---
title: First Deploy
description: Initialize a repository and deploy your first application into an existing Compartment install.
---

Use this flow after the install already exists and you can log into it.

Compartment is deploying your app here, not the Compartment platform itself.

If your app can build into a container image and run on Kubernetes, it usually fits this flow. That is true whether the code was written by a product team directly or produced with an AI coding agent and then prepared for deployment.

The Console first-deploy flow can guide either the CLI flow or a GitHub repository connection.

Open the Console at `/` when you start the install-time first-deploy setup. If your browser session can access multiple organizations, Compartment keeps the onboarding intent while you choose an organization, then continues at that organization's onboarding path, for example `/orgs/acme-dev/onboarding`.

After the install is already in use, open **Projects** and choose **Deploy my first project** or **Add project** to reopen the same flow at `/orgs/acme-dev/projects/create`. If your browser session can access multiple organizations, choose the organization first so the setup creates the project and deployment in the intended organization.

## CLI flow

Use the CLI flow when you want to deploy from a local checkout.

### 1. Initialize the repository

From the application root:

```bash
compartment init
```

That writes a minimal `compartment.yml`.

### 2. Review the generated descriptor

The smallest valid descriptor looks like this:

```yaml
name: internal-tools

services:
  web: .
```

The project name `create` is reserved for the Console create-project route, so choose another slug if your repository or directory would otherwise derive that name.

This is the first step in preparing the project for Compartment. Add `compartment.routes.yml` later only if you need browser-facing path rules beyond the default host routing.

### 3. Deploy the app

```bash
compartment deploy
```

Compartment uploads a source archive from the current checkout, queues one deployment per selected service, builds an image, and activates the deployment when runtime checks pass.

### 4. Inspect the result

```bash
compartment status
compartment logs
compartment inspect
```

`status` and `inspect` show rollout state immediately. The live route appears there after the deployment completes successfully.

The live route is assigned under the install base domain.

## Git flow

Use the Git flow when you want Compartment to connect a GitHub repository, open a descriptor pull request when needed, and deploy from the connected branch.

In the Console install-time first-deploy setup or the later **Projects** -> **Deploy my first project** or **Add project** flow, choose **Git**, connect or select the GitHub account or organization, choose the repository, branch, and target environment. The environment defaults to `production`. Then complete the descriptor pull request if the flow opens one. After the pull request is merged, Compartment syncs the connected source and shows the deployment result.

If the selected repository does not already look like an app and does not include `compartment.yml`, the Console can open a starter pull request instead of a descriptor-only pull request. That starter PR adds `compartment.yml` plus a minimal `apps/site/index.html` so the first Git deploy has something concrete to publish immediately.

Next steps:

- Read [Deploy using CLI](/deploy-apps/deploy-using-cli/).
- Read [Deploy using Git](/deploy-apps/deploy-using-git/).
- Read [Project Descriptor: compartment.yml](/deploy-apps/project-descriptor/).
- Browse the [generated CLI reference](/reference/generated/cli/deploy/).
