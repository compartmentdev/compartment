---
title: 'compartment system update'
description: 'Generated help output for compartment system update.'
---

This page is generated from the current shipped `compartment` help output.

## Help Output

```text
Usage: compartment system update [options]

Verify and update the Kubernetes platform images

Options:
  --version <version>    Platform image tag; defaults to the packaged CLI
                         release
  --kube-context <name>  Kubernetes context
  --namespace <name>     Kubernetes namespace; defaults to compartment
  --release-name <name>  Helm release name; defaults to compartment
  --output <format>      text or json (default: "text")
  --values <path>        Operator values file for the Compartment Helm chart
  --chart <path>         Compartment Helm chart path for a source CLI build
  -h, --help             display help for command
```
