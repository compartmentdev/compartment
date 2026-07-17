---
title: 'compartment system domain attach-cert'
description: 'Generated help output for compartment system domain attach-cert.'
---

This page is generated from the current shipped `compartment` help output.

## Help Output

```text
Usage: compartment system domain attach-cert [options]

Stage a TLS Secret and validate it against the pending domain

Options:
  --cert-file <path>            Full-chain PEM certificate file
  --key-file <path>             Private-key PEM file
  --expected-version <version>  Domain setup version
  --kube-context <name>         Kubernetes context
  --namespace <name>            Kubernetes namespace; defaults to compartment
  --release-name <name>         Helm release name; defaults to compartment
  --output <format>             text or json (default: "text")
  --values <path>               Operator values file for the Compartment Helm
                                chart
  --chart <path>                Compartment Helm chart path for a source CLI
                                build
  -h, --help                    display help for command
```
