---
title: 'compartment install'
description: 'Generated help output for compartment install.'
---

This page is generated from the current shipped `compartment` help output.

Related guides:

- [Install Compartment](/quickstart/install-compartment/)

## Help Output

```text
Usage: compartment install [options]

Options:
  --dev                       Install against the local repo dev API
  --api-url <url>             Public Console URL for the Kubernetes installation
  --base-domain <domain>      Base domain configured for the Kubernetes
                              installation
  --values <path>             Operator values file for the Compartment Helm
                              chart
  --chart <path>              Compartment Helm chart path for a source CLI build
  --kube-context <name>       Kubernetes context for Helm
  --namespace <name>          Kubernetes namespace; defaults to compartment
  --release-name <name>       Helm release name; defaults to compartment
  --email <email>             First admin email
  --organization <name>       First organization name
  --organization-slug <slug>
  --remote <name>             Remote name for the saved CLI session
  --output <format>           text or json (default: "text")
  -h, --help                  display help for command
```
