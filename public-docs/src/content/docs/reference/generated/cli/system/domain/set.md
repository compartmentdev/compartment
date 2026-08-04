---
title: 'compartment system domain set'
description: 'Generated help output for compartment system domain set.'
---

This page is generated from the current shipped `compartment` help output.

Related guides:

- [Install Compartment](/quickstart/install-compartment/)
- [Install Modes](/install-operate/install-modes/)
- [Install Domain](/install-operate/install-domain/)
- [System Operations](/install-operate/system-operations/)
- [Operate a Managed VM](/guides/operate-managed-vm/)

## Help Output

```text
Usage: compartment system domain set [options]

Stage a custom system domain and print required DNS records

Options:
  --base-domain <domain>  Public base domain
  --kube-context <name>   Kubernetes context
  --namespace <name>      Kubernetes namespace; defaults to compartment
  --release-name <name>   Helm release name; defaults to compartment
  --output <format>       text or json (default: "text")
  --values <path>         Operator values file for the Compartment Helm chart
  --chart <path>          Compartment Helm chart path for a source CLI build
  -h, --help              display help for command
```
