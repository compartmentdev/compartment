---
title: What Is Compartment
description: How Compartment deploys and operates small software on infrastructure you control.
---

Compartment is a self-hosted deployment system for small software on infrastructure your team controls.

Small software means apps, scripts, agents, and workflows built for a particular person, workflow, or team. Compartment gives these projects a consistent deployment and operations model: runtimes, deployment history, logs, access control, and stable URLs for services that expose web traffic.

Use Compartment when the code already exists in a repository and can be built into a container image. Compartment provides the operating layer around that code without prescribing how it was created.

## What it consists of

Compartment has two user-facing parts:

- the `compartment` CLI, which you use to install the system, log in, deploy, inspect, and operate projects;
- the self-hosted system, which exposes a browser control plane at `console.<baseDomain>` and runs deployed services on your infrastructure.

## What it can run

Compartment runs services declared in `compartment.yml`. A service can expose HTTP traffic or run as a background process.

If a project can build into a container image using a Dockerfile or [Railpack](https://railpack.com/) and run inside Docker, it can usually fit the Compartment model.

Typical examples include:

- internal tools, dashboards, and admin panels;
- shared APIs and data utilities;
- agents, scrapers, and background workers;
- automation services and scheduled workers;
- public apps and websites when the same deployment model fits.

## Working with AI agents

One of the core use cases for Compartment is working with AI coding agents.

Because the deployment model is explicit, an agent can be told to make a repository Compartment-deployable, add the required descriptor files, install Compartment on a target server, and wire up a deploy flow that matches the current docs.

That does not limit you to an agent-only workflow. You can still use a standard local CLI deploy flow, CI-driven automation, or a Git and GitHub deployment path.

## How teams usually use it

The common workflow is:

1. install one Compartment system on your infrastructure;
2. install the CLI on developer or operator machines and log in;
3. add `compartment.yml` to a repository;
4. deploy from a local checkout or connect the repository through Git;
5. inspect the deployment with `status`, `logs`, and `inspect`;
6. share web services through their assigned URLs or operate background services without a public route;
7. manage environments, domains, variables, users, and roles as the project grows.

## Core terms

- `install`: one Compartment runtime with one base domain and one control plane.
- `organization`: the collaboration boundary for users, roles, and projects.
- `project`: the deployment identity defined by `compartment.yml`.
- `environment`: the target runtime environment, such as `production` or `staging`.
- `service`: one deployable unit inside the project.
- `deployment`: one rollout attempt for one service.

Next steps:

- Read [Install Compartment](/quickstart/install-compartment/).
- Read [First Deploy](/quickstart/first-deploy/).
- Read [Deploy using CLI](/deploy-apps/deploy-using-cli/).
- Read [Deploy using Git](/deploy-apps/deploy-using-git/).
