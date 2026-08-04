---
title: 'compartment install'
description: 'Generated help output for compartment install.'
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
Usage: compartment install [options]

Options:
  --dev                         Install against the local repo dev API
  --api-url <url>               Public Console URL for the Kubernetes
                                installation
  --base-domain <domain>        Base domain configured for the Kubernetes
                                installation
  --managed-domain              Allocate a managed installation domain (default
                                when --base-domain is omitted)
  --broker-url <url>            Managed-domain broker URL
  --values <path>               Operator values file for the Compartment Helm
                                chart
  --chart <path>                Compartment Helm chart path for a source CLI
                                build
  --kube-context <name>         Kubernetes context for Helm
  --namespace <name>            Kubernetes namespace; defaults to compartment
  --release-name <name>         Helm release name; defaults to compartment
  --email <email>               First admin email
  --admin-password <password>   First admin password (automation only)
  --admin-password-file <path>  Read the first admin password from a protected
                                file
  --organization <name>         First organization name
  --organization-slug <slug>
  --remote <name>               Remote name for the saved CLI session
  --output <format>             text or json (default: "text")
  --target <target>             Installation target: vm or kubernetes
  --check                       Run read-only target preflight without making
                                changes
  --yes                         Accept the rendered mutation review
  --ingress-class <name>        IngressClass used for public Compartment hosts
  --storage-class <name>        StorageClass used for persistent platform data
  --ingress-endpoint <address>  Explicit ingress address when status is not
                                published
  -h, --help                    display help for command
```
