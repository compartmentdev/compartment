---
title: What Is Compartment
description: What Compartment is, what it runs, and how teams use it.
---

Compartment is a self-hosted application deployment system for teams that want to ship internal, private, or public web apps without building their own platform stack.

It is designed for the case where application code already exists, often from a normal product team or from AI coding agents, and you need a controlled Kubernetes platform to deploy the app, expose it on a stable URL, and manage access.

## What it consists of

Compartment has two user-facing parts:

- the `compartment` CLI, which you use to log in, deploy, inspect, and operate projects;
- the system itself, which exposes a browser control plane at `console.<baseDomain>` and hosts deployed apps under the install base domain.

Operators run `compartment install` with an operator values file. The CLI deploys its matching bundled Helm chart,
waits for the public control plane, and creates the first owner. `compartment install --dev` remains the repository
development path.

## What it can run

Compartment hosts the apps and websites you want to run on your own infrastructure.

If an app can build into a container image and run on Kubernetes, it can usually fit the Compartment model.

Internal tools are a common use case, but they are not the only one. Public apps can also fit well when the deployment model is convenient for your team. For example, this docs site and the Compartment public website are hosted with Compartment.

Typical examples include:

- internal tools and back-office apps;
- admin panels and support tools;
- private APIs and dashboards;
- public apps and websites;
- AI-generated apps that still need a secure runtime and access model.

## Working with AI agents

One of the core use cases for Compartment is working with AI coding agents.

Because the deployment model is explicit, an agent can be told to make a repository Compartment-deployable, add the required descriptor files, and wire up a deploy flow that matches the current docs. Platform installation remains an operator-owned task driven by the CLI and Helm values.

That does not limit you to an agent-only workflow. You can still use a standard local CLI deploy flow, CI-driven automation, or a Git and GitHub deployment path.

## How teams usually use it

The common workflow is:

1. install one Compartment platform in a Kubernetes cluster;
2. install the CLI on developer or operator machines;
3. log into the control plane from the CLI or browser;
4. add `compartment.yml` to a repository;
5. choose a deploy path:
   direct CLI deploy from a local checkout, or connect the repository through Git for a branch-driven flow;
6. manage URLs, variables, users, and roles as the app grows.

## Core terms

- `install`: one Compartment platform with one base domain and one control plane.
- `organization`: the collaboration boundary for users, roles, and projects.
- `project`: the app identity derived from `compartment.yml`.
- `environment`: the target runtime environment, such as `production` or `staging`.
- `service`: one deployable unit inside the project.
- `deployment`: one rollout attempt for one service.

Next steps:

- Read [Install Compartment](/quickstart/install-compartment/).
- Read [First Deploy](/quickstart/first-deploy/).
- Read [Deploy using CLI](/deploy-apps/deploy-using-cli/).
- Read [Deploy using Git](/deploy-apps/deploy-using-git/).
